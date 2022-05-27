import * as THREE from "three";
import { INTERPOLATION_TYPE } from '../InterpolationType';
import { Animation, interpolateCatmullRom } from '../Animation';
import { vector3ApplyProjection } from '../../../thirdparty/three.js/three-legacy';

export function AnnotationAnimation(root, data, animator) {
    function createAnnotation(data, viewer, state) {
        var _document = this.getDocument();
        var container = that.container = _document.createElement('div');
        var name = data.name;
        container.id = name;
        container.style.cursor = "pointer";
        container.style.visibility = state;

        var text = _document.createElement('div');
        text.id = name + '-txt';
        text.style.cssText = 'display: none;position: absolute;z-index: 1;';
        container.appendChild(text);

        var icon = _document.createElement('img');
        var isAttached = data.custom && data.custom.att && data.custom.att === 1;
        icon.src = isAttached? "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAABv1BMVEUAAAAAAAAAAAAAAAABAwEAAAAAAAAjSRkAAAAFDASJqnZhg1IqTyAjSRkpTx8hRxggRRcAAAAhRRcKFwgAAACau4R9mnFmiFUhSBgbOhMZNhIAAAAECQMgQxcAAAAAAAAAAAAHDwXB2q2jw4yfvoivyJ6fuI6mv5eSr4KAoWu2trZpiV3Nzc0wVSUhRxhNT01vb28AAAAgRBcAAAAAAAAAAAAhRxgeQBYAAAAAAAAAAAAfQRbP5MC0zqCqyJKpyJJBYje3z6WxyKOFpXF9nmkrTiG+wb5xkGVcf0xYfEg1WSpNTU0hRhgfQhYfQhZVVVVAQEAXMREcOhQcHBwSJw0AAAAAAAAWLxAVLQ8AAAAAAAAfQhYIEgYAAACbvn+DsGCGsmSUunaItGXc6dStypelxY2ZvX2Ntm2JtGnS48fB17G40aWNuWucxH6ny4mUvnPF27aPuHCEsGHV5czI3Lq52KGvzJqz1JmqyJOqzY6ew4OYwHiGs2OEsWHb29vL4LvM5bnD3q2+3KWkyoaLtWuKtmfOzs7IyMi21pyawXqPuG/g4ODX68fI4rTG4LCu0ZKszJKlx4qZwHuBnXR2iXENcZskAAAAXnRSTlMAEAIBCAsF6BUn+vPu7erjsZyBEwP99/TRk3JgRUQ1IxwO/v79/Pv6+fn09PPq08q7sqWDe2xrY01AMBj+/v7+/v37+fn59fXz8u/c1cbFxLWonZiIcm1lYVdSQT8de/EoFwAAAgVJREFUOMutklVz21AQRiNFlswYs+M6DTdN0kCDZWZmuAKDZFtgiO2YYm6TlOEHV53ptGs5j93Xc+a7e3d36P/W9prdZ/PZ17aPxphz3mR0x91G07wTG8TDo5R3HLGH3S6fGPdSo8Na/to6W2HZBEqwPCNULlu1BkFdQSyKx4qxOMoyDDJSRB/HnTcqWbSbTmVS6V3E57hvXicOBZd1gmfj6Z1kPrmTjrMMfRizumDA+k3UTcRSyWg0mkzFEgLNlU3rIIJcns0KqJjJq0I+U0SqUJlZJv8JugU3J/QnHEwu6MCMqPN1pq+H3sFxCgOC7RyT48Ev6qLUL/gmeJrJ/p0DzSnyxTtAGLMbv9dohv8zSbomSqUpOxB0AdNXsUbnGEEQmJzKq3JrLgCaJAzms5LI1enfVefEamc/YzYQYFB6/1xBUsQex3E9UZHkUvO6X48PwQjLTKEjVRVFqUqd8v6naQsMUCNcL8xTrVJZluXyl1K7OW1+7sL71x15cvVH43O7UGi3mmc8lkCE0ByMbvXazwueycbHxiXPrUdv3hLDGiF8au/d4sO7Novtnj9k0BO45uRGTp98f2JlK/RqYzN8TK8bGTjZLTXgfvDp6rMNA0ZADAOWHI6VTYwE4WAZjz/s3V5yvIxADosIPlh0BNXHSdA8LFIfDgE8WDg5hmmx9h/40fgXth2SDk3yjP4AAAAASUVORK5CYII=" :
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAABvFBMVEUAAAAAAAADAAAAAAAAAAACAAAAAAAAAAC5PznHVE8BAAAAAADbc27NXVeUDQaZDQaRBwAAAAAAAACHBgDuhoHVa2W9RD2QCAKYCAGPBgB0BQAAAAAAAACMBgAAAAADAAD2jonWb2n2jYjYbWfmeXPNzc3RYFqzODKfFA1RUVGKBgCVBwBvb2+WBwCBBgCFBgCWBwCLBgAAAAAAAACMBgCTBwByBQCTBwBbBACEBgAAAAAAAAAoAgBSBADgeHOoOzXmfnnofnjieHPGvr63t7e0tLTidW/ebmnba2XWZWDAT0qRHBfBSkRNTU2aFxGOBgBYTEsAAACNBgBAQEAAAABbBQAcHBxyBQBKBAAAAABfBAAAAAAAAAAsAgAkAgCJBgDZRT3MOTHQPDTVQjrlUkrjUEjRPjbOOjP/bGTvXFTqV0/fTETNOjL5Zl7eS0PzYFjxXlbiT0fUQTn0e3T7aGDWXFXbSEDTRj/PQTrOPjbb29vgamTxY1zoVE3STETTQjvSPzfOzs7IyMj5g3zzaWLXY13XYVrsXlbbU0zg4OD8lZD4gXq0eHXqd3HscWv2b2jrZmDQZWDdWVLkV1C5y9+5AAAAYHRSTlMAAgUBDggMEeDsIBj+8NHJxpxAEP754tDDtIFsYDkvI/78+/j08/DfycfHxbuvr5mTjYN0bWxkWVZTTDUjEfz8+/n59fT08vHw8PDw5NzV0Mq5uLWrm5iLfX1hV0g/ODZEwKduAAACAklEQVQ4y62SVXPbQBzEa1mWZYaY49ihBhtmKjMzw92JLLBsyxxT2mCZvnCVmU59VpO37Ms97G929nb+p05WXUvTE5GJ6aWuY+yFEdoVdAZd9MjCEYi5J0L3FZutSqVZdIYiPWaj/85j2yszAACGVyq7Lo+RIMZtxRaQOZaTwZZSLbrGLR2+aX54twVykpgVpRzgYbVGz5twYMPTV2ZkKZMupDOSzAiwfNazgQesDO9VASemU6lUWuQAgnyNXsEiiBlbEwE2W9CBQpbVAfRraIZoA5ZosII6EpB6MYrVpLxOQejowKsBL9UGSK+zCnnsF4omB7wkBkQHylDZ+rcDROD3hYcYQE0NHQhQ4f8uCQVG/XF9isJKLtI1TYBQQAgdPlqJzYcWMYBYd58/YJACD6UgpsTVA+51AhvKGgt9zQGN1xN4Dajs/vbtmBXf2mIP3/jGqiW9Q0nlGtn8tXBSnwGPWHYP5PcbLMs2JHFn+6p7WQ/ARTie3/rZm9+pZ+rfP/fawi8dhOFgqLlLX87dHOz/1D9ou/vsrcNiNgBrZzbf338yOXZvbDL2xm4ljCdn6j794cpswr/62p+wWy2m/042oQeMxudedK8mSdzGAy4/9vlm/STRtjGRTz9u3nnge2U3+O2h4o9GfXG7lcLKGWZY8ycduG3sQJCk0Tb+w3S0/Qemc4+eJchuZgAAAABJRU5ErkJggg==";
        icon.id = name + '-img';
        icon.style.cssText = 'display: block;position: absolute;z-index: 1;';
        container.appendChild(icon);

        viewer.api.container.appendChild(container);

        container.addEventListener('click', function () {
            text.style.display = text.style.display === 'none'? 'block' : 'none';
        });

        var color = 0x007F00;
        var opacity = 0.6;
        var geometry = new THREE.SphereGeometry(0.01);
        var material = new THREE.MeshPhongMaterial({color:color, opacity:opacity, transparent:true});
        var mesh = new THREE.Mesh(geometry, material);
        mesh.visible = false;

        if (viewer.overlayScenes["annotation"] === undefined) {
        // add annotation to an overlay scene
            viewer.createOverlayScene("annotation");
        }
        viewer.addOverlay("annotation", mesh);

        return mesh;
    }

    var that = this;
    if (root === null) {
        root = createAnnotation.call(this, data, animator.viewer, 'hidden');
    }
    Animation.call(this, root, data, animator);
    this.id = data.name;
    this.text = "";
    this.state = 'hidden';
    this.epsilon = 0.1;

    this.viewer.api.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, function(evt) {
        that.updateText(root.position, that.text);
    });
};

AnnotationAnimation.prototype = Object.create(Animation.prototype);
AnnotationAnimation.prototype.constructor = AnnotationAnimation;
AnnotationAnimation.prototype.keyTypes = ["pos", "text", "vis"];
AnnotationAnimation.prototype.defaultKey = {pos: 0, text: "", vis: 1};

AnnotationAnimation.prototype.stop = function() {
    Animation.prototype.stop.call(this);
    this.container.parentNode.removeChild(this.container);
    this.viewer.removeOverlay("annotation", this.root);
    this.root = null;
};

AnnotationAnimation.prototype.updateText = function(position, text) {
    function projectToScreen(position, camera, canvas) {
        var pos = position.clone();
        var projScreenMat = new THREE.Matrix4();
        camera.updateMatrixWorld();
        projScreenMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        pos = vector3ApplyProjection(pos, projScreenMat);

        // Center the icon (24x24) on the desired point.
        return {x: (pos.x + 1) * canvas.width / 2 + canvas.offsetLeft - 12,
                y: (-pos.y + 1) * canvas.height / 2 + canvas.offsetTop + 12};
    }
    var coord = projectToScreen(position, this.viewer.camera, this.viewer.canvas);
    var _document = this.getDocument();
    var element = _document.getElementById(this.id + '-txt');
    if (element) {
        element.innerHTML = text;
        element.style.left = coord.x + 'px';
        element.style.top = coord.y + 'px';
        this.text = text;
    }
    element = _document.getElementById(this.id + '-img');
    if (element) {
        element.style.left = coord.x + 'px';
        element.style.top = coord.y - 24 + 'px'; // adjust based on image height
    }
};

AnnotationAnimation.prototype.update = (function() {
    var points = [];
    var target = new THREE.Vector3();
    var newVector = new THREE.Vector3();

    return function(delta) {
        if (this.isPlaying === false) return;

        this.currentTime += delta * this.timeScale;

        this.resetIfLooped();

        // bail out if out of range when playing
        if (this.isPlayingOutOfRange()) return;

        var _document = this.getDocument();
        // restore and return if paused before start key
        if (this.isPaused && this.currentTime < this.startKeyTime) {
            var element = _document.getElementById(this.id);
            if (element) element.style.visibility = this.state;
            return;
        }

        for (var h = 0, hl = this.hierarchy.length; h < hl; h++) {
            var object = this.hierarchy[h];
            var animationCache = object.animationCache[this.data.name];

            // loop through keys
            for (var t = 0; t < this.keyTypes.length; t++) {
                var type = this.keyTypes[t];
                var prevKey = animationCache.prevKey[type];
                var nextKey = animationCache.nextKey[type];

                if (nextKey.time <= this.currentTime || prevKey.time >= this.currentTime) {
                    prevKey = this.data.hierarchy[h].keys[0];
                    nextKey = this.getNextKeyWith(type, h, 1);

                    while (nextKey.time < this.currentTime && nextKey.index > prevKey.index) {
                        prevKey = nextKey;
                        nextKey = this.getNextKeyWith(type, h, nextKey.index + 1);
                    }
                    animationCache.prevKey[type] = prevKey;
                    animationCache.nextKey[type] = nextKey;
                }

                var prevXYZ = prevKey[type];
                var nextXYZ = nextKey[type];

                // skip if no key or no change in key values
                if (nextKey.time === prevKey.time || prevXYZ === undefined || nextXYZ === undefined) continue;

                var scale = (this.currentTime - prevKey.time) / (nextKey.time - prevKey.time);
                if (scale < 0) scale = 0;
                if (scale > 1) scale = 1;

                // interpolate
                if (type === "pos") {
                    if (this.interpolationType === INTERPOLATION_TYPE.LINEAR) {
                        newVector.x = prevXYZ[0] + (nextXYZ[0] - prevXYZ[0]) * scale;
                        newVector.y = prevXYZ[1] + (nextXYZ[1] - prevXYZ[1]) * scale;
                        newVector.z = prevXYZ[2] + (nextXYZ[2] - prevXYZ[2]) * scale;
                        object.position.copy(newVector);
                    } else if (this.interpolationType === INTERPOLATION_TYPE.CATMULLROM ||
                        this.interpolationType === INTERPOLATION_TYPE.CATMULLROM_FORWARD) {
                        points[0] = this.getPrevKeyWith("pos", h, prevKey.index - 1)["pos"];
                        points[1] = prevXYZ;
                        points[2] = nextXYZ;
                        points[3] = this.getNextKeyWith("pos", h, nextKey.index + 1)["pos"];

                        scale = scale * 0.33 + 0.33;

                        var currentPoint = interpolateCatmullRom(points, scale);
                        newVector.x = currentPoint[0];
                        newVector.y = currentPoint[1];
                        newVector.z = currentPoint[2];
                        object.position.copy(newVector);

                        if (this.interpolationType === INTERPOLATION_TYPE.CATMULLROM_FORWARD) {
                            var forwardPoint = interpolateCatmullRom(points, scale * 1.01);

                            target.set(forwardPoint[0], forwardPoint[1], forwardPoint[2]);
                            target.sub(vector);
                            target.y = 0;
                            target.normalize();

                            var angle = Math.atan2(target.x, target.z);
                            object.rotation.set(0, angle, 0);
                        }
                    }

                } else if (type === "text") {
                    var text = Math.abs(this.currentTime - nextKey.time) < this.epsilon ? nextXYZ : prevXYZ;
                    this.updateText(object.position, text);
                } else if (type === "vis") {
                    var element = _document.getElementById(this.id);
                    if (element) {
                        var visible = Math.abs(this.currentTime - nextKey.time) < this.epsilon ? nextXYZ : prevXYZ;
                        element.style.visibility = visible? 'visible' : 'hidden';
                    }
                }
            }
            object.matrixAutoUpdate = true;
            object.matrixWorldNeedsUpdate = true;
        }
    };
})();