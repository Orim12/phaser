/**
 * @author       Richard Davey <rich@photonstorm.com>
 * @copyright    2020 Photon Storm Ltd.
 * @license      {@link https://opensource.org/licenses/MIT|MIT License}
 */

var BlendModes = require('../../BlendModes');
var CenterOn = require('../../../geom/rectangle/CenterOn');
var Class = require('../../../utils/Class');
var GetFastValue = require('../../../utils/object/GetFastValue');
var MultiPipeline = require('./MultiPipeline');
var PostFXFS = require('../shaders/PostFX-frag.js');
var Rectangle = require('../../../geom/rectangle/Rectangle');
var RenderTarget = require('../RenderTarget');
var SingleQuadFS = require('../shaders/Single-frag.js');
var SingleQuadVS = require('../shaders/Single-vert.js');
var SnapCeil = require('../../../math/snap/SnapCeil');
var TransformMatrix = require('../../../gameobjects/components/TransformMatrix');
var WEBGL_CONST = require('../const');
var WebGLPipeline = require('../WebGLPipeline');

/**
 * @classdesc
 * The SpriteFX Pipeline is a special kind of pipeline designed specifically for applying
 * special effects to Sprites. Where-as the Post FX Pipeline applies an effect _after_ the
 * object has been rendered, the Sprite FX Pipeline allows you to control the rendering of
 * the object itself - passing it off to its own texture where multi-buffer compositing
 * can take place.
 *
 * You can only use the SpriteFX Pipeline on the following types of Game Objects, or those
 * that extend from them:
 *
 * Sprite
 * Image
 * Text
 * TileSprite
 * RenderTexture
 *
 * // TODO - Explain about the fbos and functions
 *
 * @class SpriteFXPipeline
 * @extends Phaser.Renderer.WebGL.WebGLPipeline
 * @memberof Phaser.Renderer.WebGL.Pipelines
 * @constructor
 * @since 3.60.0
 *
 * @param {Phaser.Types.Renderer.WebGL.WebGLPipelineConfig} config - The configuration options for this pipeline.
 */
var SpriteFXPipeline = new Class({

    Extends: WebGLPipeline,

    initialize:

    function SpriteFXPipeline (config)
    {
        config.attributes = GetFastValue(config, 'attributes', [
            {
                name: 'inPosition',
                size: 2
            },
            {
                name: 'inTexCoord',
                size: 2
            },
            {
                name: 'inTexId'
            },
            {
                name: 'inTintEffect'
            },
            {
                name: 'inTint',
                size: 4,
                type: WEBGL_CONST.UNSIGNED_BYTE,
                normalized: true
            }
        ]);

        var fragShader = GetFastValue(config, 'fragShader', PostFXFS);
        var vertShader = GetFastValue(config, 'vertShader', SingleQuadVS);
        var drawShader = GetFastValue(config, 'drawShader', PostFXFS);

        var defaultShaders = [
            {
                name: 'DrawSprite',
                fragShader: SingleQuadFS,
                vertShader: SingleQuadVS
            },
            {
                name: 'CopySprite',
                fragShader: fragShader,
                vertShader: vertShader
            },
            {
                name: 'DrawGame',
                fragShader: drawShader,
                vertShader: SingleQuadVS
            }
        ];

        var configShaders = GetFastValue(config, 'shaders', []);

        config.shaders = defaultShaders.concat(configShaders);

        if (!config.vertShader)
        {
            config.vertShader = vertShader;
        }

        config.batchSize = 1;

        WebGLPipeline.call(this, config);

        this.isSpriteFX = true;

        /**
         * A temporary Transform Matrix, re-used internally during batching.
         *
         * @name Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#_tempMatrix1
         * @private
         * @type {Phaser.GameObjects.Components.TransformMatrix}
         * @since 3.60.0
         */
        this._tempMatrix1 = new TransformMatrix();

        /**
         * A temporary Transform Matrix, re-used internally during batching.
         *
         * @name Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#_tempMatrix2
         * @private
         * @type {Phaser.GameObjects.Components.TransformMatrix}
         * @since 3.60.0
         */
        this._tempMatrix2 = new TransformMatrix();

        /**
         * A temporary Transform Matrix, re-used internally during batching.
         *
         * @name Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#_tempMatrix3
         * @private
         * @type {Phaser.GameObjects.Components.TransformMatrix}
         * @since 3.60.0
         */
        this._tempMatrix3 = new TransformMatrix();

        /**
         * A reference to the Draw Sprite Shader belonging to this Pipeline.
         *
         * This shader is used when the sprite is drawn to this fbo (or to the game if drawToFrame is false)
         *
         * This property is set during the `boot` method.
         *
         * @name Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#drawSpriteShader
         * @type {Phaser.Renderer.WebGL.WebGLShader}
         * @default null
         * @since 3.60.0
         */
        this.drawSpriteShader;

        /**
         * A reference to the Copy Shader belonging to this Pipeline.
         *
         * This shader is used when you call the `copySprite` method.
         *
         * This property is set during the `boot` method.
         *
         * @name Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#copyShader
         * @type {Phaser.Renderer.WebGL.WebGLShader}
         * @default null
         * @since 3.60.0
         */
        this.copyShader;

        /**
         * A reference to the Game Draw Shader belonging to this Pipeline.
         *
         * This shader draws the fbo to the game.
         *
         * This property is set during the `boot` method.
         *
         * @name Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#gameShader
         * @type {Phaser.Renderer.WebGL.WebGLShader}
         * @default null
         * @since 3.60.0
         */
        this.gameShader;

        /**
         * Raw byte buffer of vertices used specifically during the copySprite method.
         *
         * @name Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#quadVertexData
         * @type {ArrayBuffer}
         * @readonly
         * @since 3.60.0
         */
        this.quadVertexData;

        /**
         * The WebGLBuffer that holds the quadVertexData.
         *
         * @name Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#quadVertexBuffer
         * @type {WebGLBuffer}
         * @readonly
         * @since 3.60.0
         */
        this.quadVertexBuffer;

        /**
         * Float32 view of the quad array buffer.
         *
         * @name Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#quadVertexViewF32
         * @type {Float32Array}
         * @since 3.60.0
         */
        this.quadVertexViewF32;

        /**
         * The largest render target dimension before we just use a full-screen target.
         *
         * @name Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#maxDimension
         * @type {number}
         * @private
         * @since 3.60.0
         */
        this.maxDimension = 0;

        /**
         * The amount in which each target frame will increase.
         *
         * Defaults to 64px but can be overridden in the config.
         *
         * @name Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#frameInc
         * @type {number}
         * @private
         * @since 3.60.0
         */
        this.frameInc = Math.floor(GetFastValue(config, 'frameInc', 64));

        /**
         * Should this pipeline create Alternative Swap Frames as well as
         * Swap Frames?
         *
         * The default is 'false', to avoid creating too many textures,
         * but some pipelines require it.
         *
         * @name Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#altFrame
         * @type {boolean}
         * @private
         * @since 3.60.0
         */
        this.altFrame = GetFastValue(config, 'altFrame', false);

        /**
         * A temporary Rectangle object re-used internally during sprite drawing.
         *
         * @name Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#spriteBounds
         * @type {Phaser.Geom.Rectangle}
         * @private
         * @since 3.60.0
         */
        this.spriteBounds = new Rectangle();

        /**
         * A temporary Rectangle object re-used internally during sprite drawing.
         *
         * @name Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#targetBounds
         * @type {Phaser.Geom.Rectangle}
         * @private
         * @since 3.60.0
         */
        this.targetBounds = new Rectangle();

        /**
         * The full-screen Render Target that the sprite is first drawn to.
         *
         * @name Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#fsTarget
         * @type {Phaser.Phaser.Renderer.WebGL.RenderTarget}
         * @since 3.60.0
         */
        this.fsTarget;

        /**
         * Transient sprite data, used for pipelines that require multiple calls to 'drawSprite'.
         *
         * @name Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#spriteData
         * @type {object}
         * @private
         * @since 3.60.0
         */
        this.spriteData = {
            sprite: null,
            x0: 0,
            y0: 0,
            x1: 0,
            y1: 0,
            x2: 0,
            y2: 0,
            x3: 0,
            y3: 0,
            u0: 0,
            v0: 0,
            u1: 0,
            v1: 0,
            tintTL: 0,
            tintTR: 0,
            tintBL: 0,
            tintBR: 0,
            tintEffect: 0,
            texture: null,
            textureIndex: 0
        };

        if (this.renderer.isBooted)
        {
            this.manager = this.renderer.pipelines;

            this.boot();
        }
    },

    boot: function ()
    {
        WebGLPipeline.prototype.boot.call(this);

        var shaders = this.shaders;
        var renderer = this.renderer;
        var targets = this.renderTargets;

        this.drawSpriteShader = shaders[0];
        this.copyShader = shaders[1];
        this.gameShader = shaders[2];

        var minDimension = Math.min(renderer.width, renderer.height);

        var qty = Math.ceil(minDimension / this.frameInc);

        for (var i = 1; i < qty; i++)
        {
            var targetWidth = i * this.frameInc;

            targets.push(new RenderTarget(renderer, targetWidth, targetWidth));

            //  Duplicate RT for swap frame
            targets.push(new RenderTarget(renderer, targetWidth, targetWidth));

            if (this.altFrame)
            {
                //  Duplicate RT for alt swap frame
                targets.push(new RenderTarget(renderer, targetWidth, targetWidth));
            }
        }

        //  Full-screen RTs
        targets.push(new RenderTarget(renderer, renderer.width, renderer.height, 1, 0, true, true));
        targets.push(new RenderTarget(renderer, renderer.width, renderer.height, 1, 0, true, true));

        if (this.altFrame)
        {
            targets.push(new RenderTarget(renderer, renderer.width, renderer.height, 1, 0, true, true));
        }

        //  Our full-screen target
        this.fsTarget = new RenderTarget(renderer, renderer.width, renderer.height, 1, 0, true, true);

        targets.push(this.fsTarget);

        this.maxDimension = (qty - 1) * this.frameInc;

        // 6 verts * 28 bytes
        var data = new ArrayBuffer(168);

        this.quadVertexData = data;

        this.quadVertexViewF32 = new Float32Array(data);

        this.quadVertexBuffer = renderer.createVertexBuffer(data, this.gl.STATIC_DRAW);

        this.onResize(renderer.width, renderer.height);

        //  So calls to set uniforms in onPreRender target the right shader:
        this.currentShader = this.copyShader;
    },

    /**
     * Handles the resizing of the quad vertex data.
     *
     * @method Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#onResize
     * @since 3.60.0
     *
     * @param {number} width - The new width of the quad.
     * @param {number} height - The new height of the quad.
     */
    onResize: function (width, height)
    {
        var vertexViewF32 = this.quadVertexViewF32;

        //  vertexBuffer indexes:

        //  Each vert: [ x, y, u, v, unit, mode, tint ]

        //  0 - 6     - vert 1 - x0/y0
        //  7 - 13    - vert 2 - x1/y1
        //  14 - 20   - vert 3 - x2/y2
        //  21 - 27   - vert 4 - x0/y0
        //  28 - 34   - vert 5 - x2/y2
        //  35 - 41   - vert 6 - x3/y3

        //  Verts
        vertexViewF32[1] = height; // y0
        vertexViewF32[22] = height; // y0
        vertexViewF32[14] = width; // x2
        vertexViewF32[28] = width; // x2
        vertexViewF32[35] = width; // x3
        vertexViewF32[36] = height; // y3
    },

    /**
     * Takes a Sprite Game Object, or any object that extends it, and renders it via this pipeline.
     *
     * @method Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#batchSprite
     * @since 3.60.0
     *
     * @param {(Phaser.GameObjects.Image|Phaser.GameObjects.Sprite)} gameObject - The texture based Game Object to add to the batch.
     * @param {Phaser.Cameras.Scene2D.Camera} camera - The Camera to use for the rendering transform.
     * @param {Phaser.GameObjects.Components.TransformMatrix} [parentTransformMatrix] - The transform matrix of the parent container, if set.
     */
    batchSprite: function (gameObject, camera, parentTransformMatrix)
    {
        //  Proxy this call to the MultiPipeline
        //  batchQuad will intercept the rendering
        MultiPipeline.prototype.batchSprite.call(this, gameObject, camera, parentTransformMatrix);
    },

    /**
     * Generic function for batching a textured quad using argument values instead of a Game Object.
     *
     * @method Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#batchTexture
     * @since 3.60.0
     *
     * @param {Phaser.GameObjects.GameObject} gameObject - Source GameObject.
     * @param {WebGLTexture} texture - Raw WebGLTexture associated with the quad.
     * @param {number} textureWidth - Real texture width.
     * @param {number} textureHeight - Real texture height.
     * @param {number} srcX - X coordinate of the quad.
     * @param {number} srcY - Y coordinate of the quad.
     * @param {number} srcWidth - Width of the quad.
     * @param {number} srcHeight - Height of the quad.
     * @param {number} scaleX - X component of scale.
     * @param {number} scaleY - Y component of scale.
     * @param {number} rotation - Rotation of the quad.
     * @param {boolean} flipX - Indicates if the quad is horizontally flipped.
     * @param {boolean} flipY - Indicates if the quad is vertically flipped.
     * @param {number} scrollFactorX - By which factor is the quad affected by the camera horizontal scroll.
     * @param {number} scrollFactorY - By which factor is the quad effected by the camera vertical scroll.
     * @param {number} displayOriginX - Horizontal origin in pixels.
     * @param {number} displayOriginY - Vertical origin in pixels.
     * @param {number} frameX - X coordinate of the texture frame.
     * @param {number} frameY - Y coordinate of the texture frame.
     * @param {number} frameWidth - Width of the texture frame.
     * @param {number} frameHeight - Height of the texture frame.
     * @param {number} tintTL - Tint for top left.
     * @param {number} tintTR - Tint for top right.
     * @param {number} tintBL - Tint for bottom left.
     * @param {number} tintBR - Tint for bottom right.
     * @param {number} tintEffect - The tint effect.
     * @param {number} uOffset - Horizontal offset on texture coordinate.
     * @param {number} vOffset - Vertical offset on texture coordinate.
     * @param {Phaser.Cameras.Scene2D.Camera} camera - Current used camera.
     * @param {Phaser.GameObjects.Components.TransformMatrix} parentTransformMatrix - Parent container.
     * @param {boolean} [skipFlip=false] - Skip the renderTexture check.
     * @param {number} [textureUnit] - Use the currently bound texture unit?
     */
    batchTexture: function (
        gameObject,
        texture,
        textureWidth, textureHeight,
        srcX, srcY,
        srcWidth, srcHeight,
        scaleX, scaleY,
        rotation,
        flipX, flipY,
        scrollFactorX, scrollFactorY,
        displayOriginX, displayOriginY,
        frameX, frameY, frameWidth, frameHeight,
        tintTL, tintTR, tintBL, tintBR, tintEffect,
        uOffset, vOffset,
        camera,
        parentTransformMatrix,
        skipFlip,
        textureUnit)
    {
        //  Proxy this call to the MultiPipeline
        //  batchQuad will intercept the rendering

        //  Needed for Text & TileSprite - how about others?
        flipY = true;

        MultiPipeline.prototype.batchTexture.call(this, gameObject, texture, textureWidth, textureHeight, srcX, srcY, srcWidth, srcHeight, scaleX, scaleY, rotation, flipX, flipY, scrollFactorX, scrollFactorY, displayOriginX, displayOriginY, frameX, frameY, frameWidth, frameHeight, tintTL, tintTR, tintBL, tintBR, tintEffect, uOffset, vOffset, camera, parentTransformMatrix, skipFlip, textureUnit);
    },

    /**
     * Adds the vertices data into the batch and flushes if full.
     *
     * Assumes 6 vertices in the following arrangement:
     *
     * ```
     * 0----3
     * |\  B|
     * | \  |
     * |  \ |
     * | A \|
     * |    \
     * 1----2
     * ```
     *
     * Where tx0/ty0 = 0, tx1/ty1 = 1, tx2/ty2 = 2 and tx3/ty3 = 3
     *
     * @method Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#batchQuad
     * @since 3.60.0
     *
     * @param {(Phaser.GameObjects.GameObject|null)} gameObject - The Game Object, if any, drawing this quad.
     * @param {number} x0 - The top-left x position.
     * @param {number} y0 - The top-left y position.
     * @param {number} x1 - The bottom-left x position.
     * @param {number} y1 - The bottom-left y position.
     * @param {number} x2 - The bottom-right x position.
     * @param {number} y2 - The bottom-right y position.
     * @param {number} x3 - The top-right x position.
     * @param {number} y3 - The top-right y position.
     * @param {number} u0 - UV u0 value.
     * @param {number} v0 - UV v0 value.
     * @param {number} u1 - UV u1 value.
     * @param {number} v1 - UV v1 value.
     * @param {number} tintTL - The top-left tint color value.
     * @param {number} tintTR - The top-right tint color value.
     * @param {number} tintBL - The bottom-left tint color value.
     * @param {number} tintBR - The bottom-right tint color value.
     * @param {(number|boolean)} tintEffect - The tint effect for the shader to use.
     * @param {WebGLTexture} [texture] - WebGLTexture that will be assigned to the current batch if a flush occurs.
     *
     * @return {boolean} `true` if this method caused the batch to flush, otherwise `false`.
     */
    batchQuad: function (gameObject, x0, y0, x1, y1, x2, y2, x3, y3, u0, v0, u1, v1, tintTL, tintTR, tintBL, tintBR, tintEffect, texture)
    {
        var padding = gameObject.fxPadding;

        //  quad bounds
        var bounds = this.spriteBounds;

        var bx = Math.min(x0, x1, x2, x3);
        var by = Math.min(y0, y1, y2, y3);
        var br = Math.max(x0, x1, x2, x3);
        var bb = Math.max(y0, y1, y2, y3);
        var bw = br - bx;
        var bh = bb - by;

        bounds.setTo(bx, by, bw, bh);

        var width = bw + (padding * 2);
        var height = bh + (padding * 2);
        var maxDimension = Math.abs(Math.max(width, height));

        var target = this.getSpriteTarget(maxDimension);

        var targetBounds = this.targetBounds.setTo(0, 0, target.width, target.height);

        //  targetBounds is the same size as the fbo and centered on the spriteBounds
        //  so we can use it when we re-render this back to the game
        CenterOn(targetBounds, bounds.centerX, bounds.centerY);

        this.spriteData.sprite = gameObject;

        //  Now draw the quad
        var gl = this.gl;
        var renderer = this.renderer;

        this.setShader(this.drawSpriteShader);

        this.set1i('uMainSampler', 0);

        this.onDrawSprite(gameObject, target);

        gameObject.onFX(this);

        var fsTarget = this.fsTarget;

        renderer.setTextureZero(texture);

        gl.viewport(0, 0, renderer.width, renderer.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fsTarget.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fsTarget.texture, 0);

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        this.batchVert(x0, y0, u0, v0, 0, tintEffect, tintTL);
        this.batchVert(x1, y1, u0, v1, 0, tintEffect, tintBL);
        this.batchVert(x2, y2, u1, v1, 0, tintEffect, tintBR);
        this.batchVert(x0, y0, u0, v0, 0, tintEffect, tintTL);
        this.batchVert(x2, y2, u1, v1, 0, tintEffect, tintBR);
        this.batchVert(x3, y3, u1, v0, 0, tintEffect, tintTR);

        this.flush();

        renderer.clearTextureZero();

        //  Now we've got the sprite drawn to our screen-sized fbo, copy the rect we need to our target
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, target.texture);

        var tx = targetBounds.x;
        var ty = renderer.height - (bb + (padding * 2));
        var tw = Math.min(renderer.width, target.width);
        var th = Math.min(renderer.height, target.height);

        if (target.height === renderer.height)
        {
            ty = 0;
        }

        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tx, ty, tw, th);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);

        //  Now we've drawn the sprite to the target (using our pipeline shader)
        //  we can pass it to the pipeline in case they want to do further
        //  manipulations with it, post-fx style, then we need to draw the
        //  results back to the game in the correct position

        this.onBatch(gameObject);

        //  Set this here, so we can immediately call the set uniform functions and it'll work on the correct shader
        this.currentShader = this.copyShader;

        this.onDraw(target, this.getSwapTarget());

        return true;
    },

    /**
     * This callback is invoked when you call the `drawSprite` method.
     *
     * It will fire after the shader has been set, but before the sprite has been drawn,
     * so use it to set any additional uniforms you may need.
     *
     * Note: Manipulating the Sprite during this callback will _not_ change how it is drawn to the Render Target.
     *
     * @method Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#onDrawSprite
     * @since 3.60.0
     *
     * @param {Phaser.GameObjects.Sprite} gameObject - The Sprite being drawn.
     * @param {Phaser.Renderer.WebGL.RenderTarget} target - The Render Target the Sprite will be drawn to.
     */
    onDrawSprite: function ()
    {
    },

    /**
     * Draws the Sprite to the given Render Target.
     *
     * Any transform or tint that has been applied to the Sprite will be retained when drawn.
     *
     * Calling this method will invoke the `onDrawSprite` callback. This callback will fire after
     * the shader has been set, but before the sprite has been drawn, so use it to set any additional
     * uniforms you may need.
     *
     * Note: Manipulating the Sprite during this callback will _not_ change how it is drawn to the Render Target.
     *
     * @method Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#drawSprite
     * @since 3.60.0
     *
     * @param {Phaser.Renderer.WebGL.RenderTarget} target - The Render Target to draw the Sprite to.
     * @param {boolean} [clear=false] - Clear the Render Target before drawing the Sprite?
     * @param {Phaser.Renderer.WebGL.WebGLShader} [shader] - The shader to use to draw the Sprite. Defaults to the `drawSpriteShader`.
     */
    drawSprite: function (target, clear, shader)
    {
        if (clear === undefined) { clear = false; }
        if (shader === undefined) { shader = this.drawSpriteShader; }

        //  TODO - Use the image stored in this.fsTarget (and remove spriteData object)

        /*
        var gl = this.gl;
        var data = this.spriteData;
        var renderer = this.renderer;

        this.setShader(shader);

        this.set1i('uMainSampler', 0);

        this.onDrawSprite(data.sprite, target);

        data.sprite.onFX(this);

        renderer.setTextureZero(data.texture);

        gl.viewport(0, 0, renderer.width, renderer.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);

        if (clear)
        {
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }

        var tintEffect = data.tintEffect;

        this.batchVert(data.x0, data.y0, data.u0, data.v0, 0, tintEffect, data.tintTL);
        this.batchVert(data.x1, data.y1, data.u0, data.v1, 0, tintEffect, data.tintBL);
        this.batchVert(data.x2, data.y2, data.u1, data.v1, 0, tintEffect, data.tintBR);
        this.batchVert(data.x0, data.y0, data.u0, data.v0, 0, tintEffect, data.tintTL);
        this.batchVert(data.x2, data.y2, data.u1, data.v1, 0, tintEffect, data.tintBR);
        this.batchVert(data.x3, data.y3, data.u1, data.v0, 0, tintEffect, data.tintTR);

        this.flush();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);

        renderer.clearTextureZero();
        */
    },

    /**
     * Gets a Render Target the right size to render the Sprite on.
     *
     * If the Sprite exceeds the size of the renderer, the Render Target will only ever be the maximum
     * size of the renderer.
     *
     * @method Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#getSpriteTarget
     * @since 3.60.0
     *
     * @return {Phaser.Renderer.WebGL.RenderTarget} A Render Target large enough to fit the sprite.
     */
    getSpriteTarget: function (size)
    {
        var targets = this.renderTargets;

        //  2 for just swap
        //  3 for swap + alt swap
        var offset = (this.altFrame) ? 3 : 2;

        if (size > this.maxDimension)
        {
            this.spriteData.textureIndex = targets.length - offset;

            return targets[this.spriteData.textureIndex];
        }
        else
        {
            var index = (SnapCeil(size, 64, 0, true) - 1) * offset;

            this.spriteData.textureIndex = index;

            return targets[index];
        }
    },

    /**
     * Gets a matching Render Target, the same size as the one the Sprite was drawn to,
     * useful for double-buffer style effects such as blurs.
     *
     * @method Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#getSwapTarget
     * @since 3.60.0
     *
     * @return {Phaser.Renderer.WebGL.RenderTarget} The Render Target swap frame.
     */
    getSwapTarget: function ()
    {
        return this.renderTargets[this.spriteData.textureIndex + 1];
    },

    /**
     * Gets a matching Render Target, the same size as the one the Sprite was drawn to,
     * useful for double-buffer style effects such as blurs.
     *
     * @method Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#getAltSwapTarget
     * @since 3.60.0
     *
     * @return {Phaser.Renderer.WebGL.RenderTarget} The Render Target swap frame.
     */
    getAltSwapTarget: function ()
    {
        if (this.altFrame)
        {
            return this.renderTargets[this.spriteData.textureIndex + 2];
        }
    },

    /**
     * This callback is invoked when you call the `copySprite` method.
     *
     * It will fire after the shader has been set, but before the source target has been copied,
     * so use it to set any additional uniforms you may need.
     *
     * Note: Manipulating the Sprite during this callback will _not_ change the Render Targets.
     *
     * @method Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#onCopySprite
     * @since 3.60.0
     *
     * @param {Phaser.Renderer.WebGL.RenderTarget} source - The source Render Target being copied from.
     * @param {Phaser.Renderer.WebGL.RenderTarget} target - The target Render Target that will be copied to.
     * @param {Phaser.GameObjects.Sprite} gameObject - The Sprite being copied.
     */
    onCopySprite: function ()
    {
    },

    /**
     * Copy the `source` Render Target to the `target` Render Target.
     *
     * No target resizing takes place. If the `source` Render Target is larger than the `target`,
     * then only a portion the same size as the `target` dimensions is copied across.
     *
     * Make sure you have enabled `drawToFrame` on this pipeline, or this method won't do anything.
     *
     * Calling this method will invoke the `onCopySprite` handler and will also call
     * the `onFXCopy` callback on the Sprite. Both of these happen prior to the copy, allowing you
     * to use them to set shader uniforms and other values.
     *
     * @method Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#copySprite
     * @since 3.60.0
     *
     * @param {Phaser.Renderer.WebGL.RenderTarget} source - The source Render Target being copied from.
     * @param {Phaser.Renderer.WebGL.RenderTarget} target - The target Render Target that will be copied to.
     * @param {Phaser.GameObjects.Sprite} gameObject - The Sprite being copied.
     * @param {boolean} [clear=true] - Clear the target before copying?
     * @param {boolean} [clearAlpha=true] - Clear the alpha channel when running `gl.clear` on the target?
     * @param {boolean} [eraseMode=false] - Erase source from target using ERASE Blend Mode?
     * @param {Phaser.Renderer.WebGL.WebGLShader} [shader] - The shader to use to copy the target. Defaults to the `copyShader`.
     */
    copySprite: function (source, target, clear, clearAlpha, eraseMode, shader)
    {
        if (clear === undefined) { clear = true; }
        if (clearAlpha === undefined) { clearAlpha = true; }
        if (eraseMode === undefined) { eraseMode = false; }
        if (shader === undefined) { shader = this.copyShader; }

        var gl = this.gl;
        var sprite = this.spriteData.sprite;

        this.currentShader = shader;

        var wasBound = this.setVertexBuffer(this.quadVertexBuffer);

        shader.bind(wasBound, false);

        this.set1i('uMainSampler', 0);

        sprite.onFXCopy(this);

        this.onCopySprite(source, target, sprite);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, source.texture);

        if (source.height > target.height)
        {
            gl.viewport(0, 0, source.width, source.height);

            this.setTargetUVs(source, target);
        }
        else
        {
            var diff = target.height - source.height;

            gl.viewport(0, diff, source.width, source.height);

            this.resetUVs();
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);

        if (clear)
        {
            gl.clearColor(0, 0, 0, Number(!clearAlpha));

            gl.clear(gl.COLOR_BUFFER_BIT);
        }

        if (eraseMode)
        {
            var blendMode = this.renderer.currentBlendMode;

            this.renderer.setBlendMode(BlendModes.ERASE);
        }

        gl.bufferData(gl.ARRAY_BUFFER, this.quadVertexData, gl.STATIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        if (eraseMode)
        {
            this.renderer.setBlendMode(blendMode);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    /**
     * Draws the `source1` and `source2` Render Targets to the `target` Render Target
     * using a linear blend effect, which is controlled by the `strength` parameter.
     *
     * @method Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#blendFrames
     * @since 3.60.0
     *
     * @param {Phaser.Renderer.WebGL.RenderTarget} source1 - The first source Render Target.
     * @param {Phaser.Renderer.WebGL.RenderTarget} source2 - The second source Render Target.
     * @param {Phaser.Renderer.WebGL.RenderTarget} [target] - The target Render Target.
     * @param {number} [strength=1] - The strength of the blend.
     * @param {boolean} [clearAlpha=true] - Clear the alpha channel when running `gl.clear` on the target?
     */
    blendFrames: function (source1, source2, target, strength, clearAlpha)
    {
        this.manager.blendFrames(source1, source2, target, strength, clearAlpha);
    },

    /**
     * Draws the `source1` and `source2` Render Targets to the `target` Render Target
     * using an additive blend effect, which is controlled by the `strength` parameter.
     *
     * @method Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#blendFramesAdditive
     * @since 3.60.0
     *
     * @param {Phaser.Renderer.WebGL.RenderTarget} source1 - The first source Render Target.
     * @param {Phaser.Renderer.WebGL.RenderTarget} source2 - The second source Render Target.
     * @param {Phaser.Renderer.WebGL.RenderTarget} [target] - The target Render Target.
     * @param {number} [strength=1] - The strength of the blend.
     * @param {boolean} [clearAlpha=true] - Clear the alpha channel when running `gl.clear` on the target?
     */
    blendFramesAdditive: function (source1, source2, target, strength, clearAlpha)
    {
        this.manager.blendFramesAdditive(source1, source2, target, strength, clearAlpha);
    },

    /**
     * This method will copy the given Render Target to the game canvas using the `copyShader`.
     *
     * This applies the results of the copy shader during the draw.
     *
     * If you wish to copy the target without any effects see the `copyToGame` method instead.
     *
     * This method should be the final thing called in your pipeline.
     *
     * @method Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#drawToGame
     * @since 3.60.0
     *
     * @param {Phaser.Renderer.WebGL.RenderTarget} source - The Render Target to draw to the game.
     */
    drawToGame: function (source)
    {
        this.currentShader = null;

        this.setShader(this.copyShader);

        this.bindAndDraw(source);
    },

    /**
     * This method will copy the given Render Target to the game canvas using the `gameShader`.
     *
     * Unless you've changed it, the `gameShader` copies the target without modifying it, just
     * ensuring it is placed in the correct location on the canvas.
     *
     * If you wish to draw the target with and apply the fragment shader at the same time,
     * see the `drawToGame` method instead.
     *
     * This method should be the final thing called in your pipeline.
     *
     * @method Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#copyToGame
     * @since 3.60.0
     *
     * @param {Phaser.Renderer.WebGL.RenderTarget} source - The Render Target to copy to the game.
     */
    copyToGame: function (source)
    {
        this.currentShader = null;

        this.setShader(this.gameShader);

        this.bindAndDraw(source);
    },

    /**
     * This method is called by `drawToGame` and `copyToGame`. It takes the source Render Target
     * and copies it back to the game canvas, or the next frame buffer in the stack, and should
     * be considered the very last thing this pipeline does.
     *
     * You don't normally need to call this method, or override it, however it is left public
     * should you wish to do so.
     *
     * Note that it does _not_ set a shader. You should do this yourself if invoking this.
     *
     * @method Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#bindAndDraw
     * @since 3.60.0
     *
     * @param {Phaser.Renderer.WebGL.RenderTarget} source - The Render Target to draw to the game.
     */
    bindAndDraw: function (source)
    {
        var gl = this.gl;
        var renderer = this.renderer;

        this.set1i('uMainSampler', 0);

        renderer.popFramebuffer(false, false, false);

        if (!renderer.currentFramebuffer)
        {
            gl.viewport(0, 0, renderer.width, renderer.height);
        }

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, source.texture);

        var matrix = this._tempMatrix1.loadIdentity();

        var x = this.targetBounds.x;
        var y = this.targetBounds.y;

        var xw = x + source.width;
        var yh = y + source.height;

        var x0 = matrix.getX(x, y);
        var x1 = matrix.getX(x, yh);
        var x2 = matrix.getX(xw, yh);
        var x3 = matrix.getX(xw, y);

        //  Regular verts
        var y0 = matrix.getY(x, y);
        var y1 = matrix.getY(x, yh);
        var y2 = matrix.getY(xw, yh);
        var y3 = matrix.getY(xw, y);

        //  Flip verts:
        // var y0 = matrix.getY(x, yh);
        // var y1 = matrix.getY(x, y);
        // var y2 = matrix.getY(xw, y);
        // var y3 = matrix.getY(xw, yh);

        this.batchVert(x0, y0, 0, 0, 0, 0, 0xffffff);
        this.batchVert(x1, y1, 0, 1, 0, 0, 0xffffff);
        this.batchVert(x2, y2, 1, 1, 0, 0, 0xffffff);
        this.batchVert(x0, y0, 0, 0, 0, 0, 0xffffff);
        this.batchVert(x2, y2, 1, 1, 0, 0, 0xffffff);
        this.batchVert(x3, y3, 1, 0, 0, 0, 0xffffff);

        this.flush();

        renderer.resetTextures();

        //  No hanging references
        this.spriteData.sprite = null;
        this.spriteData.texture = null;
    },

    /**
     * This method is called every time the `batchSprite` method is called and is passed a
     * reference to the current render target.
     *
     * If you override this method, then it should make sure it calls either the
     * `drawToGame` or `copyToGame` methods as the final thing it does. However, you can do as
     * much additional processing as you like prior to this.
     *
     * @method Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#onDraw
     * @since 3.60.0
     *
     * @param {Phaser.Renderer.WebGL.RenderTarget} target - The Render Target to draw to the game.
     * @param {Phaser.Renderer.WebGL.RenderTarget} swapTarget - The Swap Render Target, useful for double-buffef effects.
     */
    onDraw: function (target)
    {
        this.drawToGame(target);
    },

    /**
     * Set the UV values for the 6 vertices that make up the quad used by the copy shader.
     *
     * Be sure to call `resetUVs` once you have finished manipulating the UV coordinates.
     *
     * @method Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#setUVs
     * @since 3.60.0
     *
     * @param {number} uA - The u value of vertex A.
     * @param {number} vA - The v value of vertex A.
     * @param {number} uB - The u value of vertex B.
     * @param {number} vB - The v value of vertex B.
     * @param {number} uC - The u value of vertex C.
     * @param {number} vC - The v value of vertex C.
     * @param {number} uD - The u value of vertex D.
     * @param {number} vD - The v value of vertex D.
     */
    setUVs: function (uA, vA, uB, vB, uC, vC, uD, vD)
    {
        var vertexViewF32 = this.quadVertexViewF32;

        vertexViewF32[2] = uA;
        vertexViewF32[3] = vA;

        vertexViewF32[9] = uB;
        vertexViewF32[10] = vB;

        vertexViewF32[16] = uC;
        vertexViewF32[17] = vC;

        vertexViewF32[23] = uA;
        vertexViewF32[24] = vA;

        vertexViewF32[30] = uC;
        vertexViewF32[31] = vC;

        vertexViewF32[37] = uD;
        vertexViewF32[38] = vD;
    },

    /**
     * Sets the vertex UV coordinates of the quad used by the copy shaders
     * so that they correctly adjust the texture coordinates for a blit frame effect.
     *
     * Be sure to call `resetUVs` once you have finished manipulating the UV coordinates.
     *
     * @method Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#setTargetUVs
     * @since 3.60.0
     *
     * @param {Phaser.Renderer.WebGL.RenderTarget} source - The source Render Target.
     * @param {Phaser.Renderer.WebGL.RenderTarget} target - The target Render Target.
     */
    setTargetUVs: function (source, target)
    {
        var diff = (target.height / source.height);

        if (diff > 0.5)
        {
            diff = 0.5 - (diff - 0.5);
        }
        else
        {
            diff = 0.5 + (0.5 - diff);
        }

        this.setUVs(0, diff, 0, 1 + diff, 1, 1 + diff, 1, diff);
    },

    /**
     * Resets the quad vertice UV values to their default settings.
     *
     * The quad is used by the copy shader in this pipeline.
     *
     * @method Phaser.Renderer.WebGL.Pipelines.SpriteFXPipeline#resetUVs
     * @since 3.60.0
     */
    resetUVs: function ()
    {
        this.setUVs(0, 0, 0, 1, 1, 1, 1, 0);
    }

});

module.exports = SpriteFXPipeline;
