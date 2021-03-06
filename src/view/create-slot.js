/**
 * @file 创建 slot 元素
 * @author errorrik(errorrik@gmail.com)
 */


var each = require('../util/each');
var createANode = require('../parser/create-a-node');
var ExprType = require('../parser/expr-type');
var parseTemplate = require('../parser/parse-template');
var evalExpr = require('../runtime/eval-expr');
var Data = require('../runtime/data');
var DataChangeType = require('../runtime/data-change-type');
var changeExprCompare = require('../runtime/change-expr-compare');
var removeEl = require('../browser/remove-el');
var NodeType = require('./node-type');
var attachings = require('./attachings');
var isEndStump = require('./is-end-stump');
var LifeCycle = require('./life-cycle');
var isComponent = require('./is-component');
var genElementChildrenHTML = require('./gen-element-children-html');
var nodeInit = require('./node-init');
var nodeDispose = require('./node-dispose');
var createNodeByEl = require('./create-node-by-el');
var elementDisposeChildren = require('./element-dispose-children');
var elementUpdateChildren = require('./element-update-children');
var elementOwnToPhase = require('./element-own-to-phase');
var elementOwnPushChildANode = require('./element-own-push-child-anode');
var nodeOwnSimpleAttached = require('./node-own-simple-attached');
var nodeOwnOnlyChildrenAttach = require('./node-own-only-children-attach');

/**
 * 创建 slot 元素
 *
 * @param {Object} options 初始化参数
 * @return {Object}
 */
function createSlot(options) {
    options.literalOwner = options.owner;
    var aNode = createANode();

    // #[begin] reverse
    if (options.el) {
        if (options.stumpText.indexOf('!') !== 0) {
            options.isInserted = true;
        }
        else {
            options.stumpText = options.stumpText.slice(1);
        }

        aNode = parseTemplate(options.stumpText).children[0];
        var nameBind = aNode.props.get('name');
        options.name = nameBind ? nameBind.raw : '____';
    }
    else {
    // #[end]

        var nameBind = options.aNode.props.get('name');
        options.name = nameBind ? nameBind.raw : '____';

        var givenSlots = options.literalOwner.aNode.givenSlots;
        var givenChildren = givenSlots && givenSlots[options.name];
        aNode.children = givenChildren || options.aNode.children.slice(0);

        if (givenChildren) {
            options.isInserted = true;
        }

        aNode.vars = options.aNode.vars;

    // #[begin] reverse
    }
    // #[end]

    var initData = {};
    each(aNode.vars, function (varItem) {
        options.isScoped = true;
        initData[varItem.name] = evalExpr(varItem.expr, options.scope, options.literalOwner);
    });

    if (options.isScoped) {
        options.realScope = new Data(initData);
    }

    if (options.isInserted) {
        options.owner = options.literalOwner.owner;
        !options.isScoped && (options.scope = options.literalOwner.scope);
    }


    options.aNode = aNode;


    var node = nodeInit(options);
    node.lifeCycle = LifeCycle.start;
    node.children = [];
    node.nodeType = NodeType.SLOT;
    node.dispose = slotOwnDispose;
    node.attach = nodeOwnOnlyChildrenAttach;

    node._toPhase = elementOwnToPhase;
    node._getEl = slotOwnGetEl;
    node._attachHTML = slotOwnAttachHTML;
    node._attached = nodeOwnSimpleAttached;
    node._update = slotOwnUpdate;

    // #[begin] reverse
    node._pushChildANode = elementOwnPushChildANode;
    // #[end]

    if (options.isInserted && !options.isScoped) {
        var parent = node.parent;
        while (parent) {
            if (isComponent(parent) && parent.owner === node.owner) {
                parent.slotChildren.push(node);
                break;
            }

            parent = parent.parent;
        }
    }

    // #[begin] reverse
    if (options.el) {
        removeEl(options.el);
        /* eslint-disable no-constant-condition */
        while (1) {
        /* eslint-enable no-constant-condition */
            var next = options.elWalker.next;
            if (!next || isEndStump(next, 'slot')) {
                if (next) {
                    options.elWalker.goNext();
                    removeEl(next);
                }
                break;
            }

            options.elWalker.goNext();
            var child = createNodeByEl(
                next,
                node,
                options.elWalker,
                node.realScope || node.scope
            );
            node.children.push(child);
        }

        if (options.isInserted) {
            options.literalOwner.aNode.givenSlots[node.name] = node.aNode;
        }
    }
    // #[end]

    return node;
}

/**
 * 视图更新函数
 *
 * @param {Array} changes 数据变化信息
 * @param {boolean=} isFromOuter 变化信息是否来源于父组件之外的组件
 */
function slotOwnUpdate(changes, isFromOuter) {
    var me = this;
    if (me.isScoped) {
        each(me.aNode.vars, function (varItem) {
            me.realScope.set(varItem.name, evalExpr(varItem.expr, me.scope, me.literalOwner));
        });


        var scopedChanges = [];
        each(changes, function (change) {
            each(me.aNode.vars, function (varItem) {
                var name = varItem.name;
                var relation = changeExprCompare(change.expr, varItem.expr, me.scopeParent);

                if (relation < 1) {
                    return;
                }

                if (change.type === DataChangeType.SET) {
                    scopedChanges.push({
                        type: DataChangeType.SET,
                        expr: {
                            type: ExprType.ACCESSOR,
                            paths: [
                                {type: ExprType.STRING, value: name}
                            ]
                        },
                        value: me.realScope.get(name),
                        option: change.option
                    });
                }
                else if (relation === 2) {
                    scopedChanges.push({
                        expr: {
                            type: ExprType.ACCESSOR,
                            paths: [
                                {type: ExprType.STRING, value: name}
                            ]
                        },
                        type: DataChangeType.SPLICE,
                        index: change.index,
                        deleteCount: change.deleteCount,
                        value: change.value,
                        insertions: change.insertions,
                        option: change.option
                    });
                }
            });
        });

        elementUpdateChildren(me, scopedChanges);
    }
    else if (me.isInserted && isFromOuter || !me.isInserted) {
        elementUpdateChildren(me, changes);
    }
}

/**
 * attach元素的html
 *
 * @param {Object} buf html串存储对象
 */
function slotOwnAttachHTML(buf) {
    genElementChildrenHTML(this, buf, this.realScope || this.scope);
    attachings.add(this);
}

/**
 * 获取 slot 对应的主元素
 * slot 是片段的管理，没有主元素，所以直接返回爹的主元素，不持有引用
 *
 * @return {HTMLElement}
 */
function slotOwnGetEl() {
    return this.parent._getEl();
}

/**
 * 销毁释放 slot
 *
 * @param {Object=} options dispose行为参数
 */
function slotOwnDispose(options) {
    this.realScope = null;
    this.literalOwner = null;

    elementDisposeChildren(this, options);
    nodeDispose(this);
}


exports = module.exports = createSlot;
