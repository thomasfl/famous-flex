/**
 * This Source Code is licensed under the MIT license. If a copy of the
 * MIT-license was not distributed with this file, You can obtain one at:
 * http://opensource.org/licenses/mit-license.html.
 *
 * @author: Hein Rutjes (IjzerenHein)
 * @license MIT
 * @copyright Gloey Apps, 2014
 */

/*global define*/
/*eslint no-use-before-define:0 */

/**
 * Internal LayoutNode class used by `FlowLayoutController`.
 *
 * @module
 */
define(function(require, exports, module) {

    // import dependencies
    var OptionsManager = require('famous/core/OptionsManager');
    var Transform = require('famous/core/Transform');
    var Vector = require('famous/math/Vector');
    var Particle = require('famous/physics/bodies/Particle');
    var Spring = require('famous/physics/forces/Spring');
    var PhysicsEngine = require('famous/physics/PhysicsEngine');
    var LayoutNode = require('./LayoutNode');

    /**
     * @class
     * @extends LayoutNode
     * @param {Object} renderNode Render-node which this layout-node represents
     * @param {Spec} spec Initial state
     * @param {Object} physicsEngines physics-engines to use
     * @alias module:FlowLayoutNode
     */
    function FlowLayoutNode(renderNode, spec) {
        LayoutNode.apply(this, arguments);

        if (!this.options) {
            this.options = Object.create(this.constructor.DEFAULT_OPTIONS);
            this._optionsManager = new OptionsManager(this.options);
        }

        if (!this._pe) {
            this._pe = new PhysicsEngine();
        }

        this._options = {
            spring: {
                dampingRatio: 0.8,
                period: 300
            }
        };

        if (!this._properties) {
            this._properties = {
                /*opacity: undefined,
                size: undefined,
                origin: undefined,
                align: undefined,
                translate: undefined,
                skew: undefined,
                rotate: undefined,
                scale: undefined*/
            };
        }
        else {
            for (var propName in this._properties) {
                this._properties[propName].init = false;
                delete this._locks;
            }
        }

        this._initial = true;
        this._endStateReached = false;
        if (spec) {
            this.setSpec(spec);
        }
    }
    FlowLayoutNode.prototype = Object.create(LayoutNode.prototype);
    FlowLayoutNode.prototype.constructor = FlowLayoutNode;

    FlowLayoutNode.DEFAULT_OPTIONS = {
        spring: {
            dampingRatio: 0.8,
            period: 300
        }
    };

    /**
     * Defaults
     */
    var DEFAULT = {
        opacity: 1,
        size: [0, 0],
        origin: [0, 0],
        align: [0, 0],
        scale: [1, 1, 1],
        translate: [0, 0, 0],
        rotate: [0, 0, 0],
        skew: [0, 0, 0]
    };

    /**
     * Sets the configuration options
     */
    FlowLayoutNode.prototype.setOptions = function(options) {
        this._optionsManager.setOptions(options);
        for (var propName in this._properties) {
            var prop = this._properties[propName];
            if (prop.force) {
                var springOptions = {};
                for (var key in this.options.spring) {
                    springOptions[key] = this.options.spring[key];
                }
                springOptions.anchor = prop.endState;
                prop.force.setOptions(springOptions);
            }
        }
        return this;
    };

    /**
     * Set the properties from a spec.
     */
    function _equalsXYZ(ar1, ar2) {
        return (ar1[0] === ar2[0]) && (ar1[1] === ar2[1]) && (ar1[2] === ar2[2]);
    }
    FlowLayoutNode.prototype.setSpec = function(spec) {
        var set = {};
        if (spec.opacity !== undefined) {
            set.opacity = spec.opacity;
        }
        if (spec.size !== undefined) {
            set.size = spec.size;
        }
        if (spec.align !== undefined) {
            set.align = spec.align;
        }
        if (spec.origin !== undefined) {
            set.origin = spec.origin;
        }
        if (spec.transform) {
            var transform = Transform.interpret(spec.transform);
            if (!_equalsXYZ(transform.translate, DEFAULT.translate)) {
                set.translate = transform.translate;
            }
            if (!_equalsXYZ(transform.scale, DEFAULT.scale)) {
                set.scale = transform.scale;
            }
            if (!_equalsXYZ(transform.skew, DEFAULT.skew)) {
                set.skew = transform.skew;
            }
            if (!_equalsXYZ(transform.rotate, DEFAULT.rotate)) {
                set.rotate = transform.rotate;
            }
        }
        this.set(set);
        return set;
    };

    /**
     * Reset the end-state. This function is called on all layout-nodes prior to
     * calling the layout-function. So that the layout-function starts with a clean slate.
     */
    FlowLayoutNode.prototype.reset = function() {
        if (this._invalidated) {
            for (var propName in this._properties) {
                this._properties[propName].endState.set(DEFAULT[propName]);
            }
            this._invalidated = false;
        }
        this._spec.trueSizeRequested = false;
    };

    /**
     * Markes the node for removal.
     */
    FlowLayoutNode.prototype.remove = function(removeSpec) {

        // Transition to the remove-spec state
        if (removeSpec) {

            // Stop the particle from moving by setting the end-state
            // to the current particle state
            for (var propName in this._properties) {
                if (removeSpec[propName] === undefined) {
                    this._properties[propName].endState.set(
                        this._properties[propName].particle.position.get()
                    );
                }
            }

            // Set end-state
            this.setSpec(removeSpec);
        }
        else {

            // No end-state specified, remove immediately
            this._endStateReached = true;
        }

        // Mark for removal
        this._removing = true;
        this._invalidated = false;
    };

    function _getPropertyValue(prop, def) {
        return (prop && prop.init) ? (prop.endStateReached ? prop.endState.get() : prop.particle.getPosition()) : def;
    }

    function _getOpacityValue() {
        var prop = this._properties.opacity;
        return (prop && prop.init) ? Math.max(0,Math.min(1, prop.particle.getPosition1D())) : undefined;
    }

    /**
     * Creates the render-spec
     */
    var ENERGY_RESTTOLERANCE = 1e-4;
    var RESTTOLERANCE = {
        opacity:    1e-5,
        size:       0.1,
        origin:     1e-5,
        align:      1e-5,
        scale:      1e-5,
        translate:  0.1,
        rotate:     1e-5,
        skew:       1e-5
    };
    FlowLayoutNode.prototype.getSpec = function() {

        // Check whether the any property is still animating
        if (!this._endStateReached &&
            !(!this._invalidated && this._initial)) { // when a node was added (e.g. using insert), but it was immediately not layed-out, then remove it
            this._endStateReached = true;
            for (var propName in this._properties) {
                var prop = this._properties[propName];
                if (prop.init) {
                    prop.endStateReached = true;
                    var restTolerance = RESTTOLERANCE[propName];
                    var energy = prop.particle.getEnergy();
                    if (energy > ENERGY_RESTTOLERANCE) {
                        //console.log('endstate nog reached: ' + propName + ' - energy: ' + energy);
                        this._endStateReached = false;
                        prop.endStateReached = false;
                    }
                    else {
                        var curState = prop.particle.getPosition();
                        var endState = prop.endState.get();
                        if (endState.length !== curState.length) {
                            //console.log('endstate nog reached: ' + propName + ' - length !=');
                            this._endStateReached = false;
                            prop.endStateReached = false;
                        }
                        for (var i = 0; i < curState.length; i++) {
                            if (Math.abs(curState[i] - endState[i]) > restTolerance) {
                                //console.log('endstate not reached: ' + propName + ' - ' + curState[i] + ' != ' + endState[i]);
                                this._endStateReached = false;
                                prop.endStateReached = false;
                                break;
                            }
                        }
                    }
                }
            }
        }
        else {

            // Animations have stopped
            //return !this._invalidated ? undefined : this._spec;
            if (this._invalidated) {
                return this._spec;
            }
            else {
                return undefined;
            }
        }

        // Animations are still going, build new spec
        this._initial = false;
        this._spec.opacity = _getOpacityValue.call(this);
        this._spec.size = _getPropertyValue(this._properties.size, undefined);
        this._spec.align = _getPropertyValue(this._properties.align, undefined);
        this._spec.origin = _getPropertyValue(this._properties.origin, undefined);
        this._spec.transform = Transform.build({
            translate: _getPropertyValue(this._properties.translate, DEFAULT.translate),
            skew: _getPropertyValue(this._properties.skew, DEFAULT.skew),
            scale: _getPropertyValue(this._properties.scale, DEFAULT.scale),
            rotate: _getPropertyValue(this._properties.rotate, DEFAULT.rotate)
        });

        /*console.log(JSON.stringify({
            opacity: this._spec.opacity,
            size: this._spec.size,
            align: this._spec.align,
            origin: this._spec.origin,
            transform: this._spec.transform
        }));*/

        return this._spec;
    };

    /**
     * Locks a property, or a specific array-dimension of the property
     * fixed to the end-state value. Use this to e.g. lock the x-translation
     * to a the fixed end-state, so that when scrolling the renderable sticks
     * to the x-axis and does not feel sluggish.
     */
    FlowLayoutNode.prototype.lock = function(property, lock, endStateReached) {

        // Update lock
        if (!this._locks) {
            this._locks = {};
        }
        this._locks[property] = lock;
        if (endStateReached !== undefined) {
            if (this._properties[property]) {
                this._properties[property].endStateReached = endStateReached;
            }
        }
    };

    /**
     * Set the content of the node
     *
     * @param {Object} set
     */
     var AXES = {
        opacity:    Particle.AXES.X,
        size:       Particle.AXES.X | Particle.AXES.Y,
        origin:     Particle.AXES.X | Particle.AXES.Y,
        align:      Particle.AXES.X | Particle.AXES.Y,
        scale:      Particle.AXES.X | Particle.AXES.Y | Particle.AXES.Z,
        translate:  Particle.AXES.X | Particle.AXES.Y | Particle.AXES.Z,
        rotate:     Particle.AXES.X | Particle.AXES.Y | Particle.AXES.Z,
        skew:       Particle.AXES.X | Particle.AXES.Y | Particle.AXES.Z
    };
    FlowLayoutNode.prototype.set = function(set) {
        for (var propName in set) {
            var value = set[propName];
            if (value !== undefined) {
                var prop = this._properties[propName];
                if (!prop) {
                    prop = {
                        particle: new Particle({
                            axis: AXES[propName],
                            position: this._initial ? value : DEFAULT[propName]
                        }),
                        endState: new Vector(value),
                        init: true,
                        endStateReached: true
                    };
                    var springOptions = {};
                    for (var key in this.options.spring) {
                        springOptions[key] = this.options.spring[key];
                    }
                    springOptions.anchor = prop.endState;
                    prop.force = new Spring(springOptions);
                    this._pe.addBody(prop.particle);
                    prop.forceId = this._pe.attach(prop.force, prop.particle);
                    this._properties[propName] = prop;
                }
                else {
                    if (!prop.init) {
                        prop.particle.setPosition(value);
                        prop.init = true;
                        prop.endStateReached = true;
                    }
                    prop.endState.set(value);
                }
                if ((this._locks && this._locks[propName] && prop.endStateReached) || this.options.spring.disabled) {
                    prop.particle.setPosition(value);
                }
                this._invalidated = true;
                this._removing = false;
                this._endStateReached = false;
            }
        }
    };

    module.exports = FlowLayoutNode;
});
