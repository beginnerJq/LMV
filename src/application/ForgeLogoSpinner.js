import { GlobalManagerMixin } from './GlobalManagerMixin';
const FADE_DURATION = 416; // This value came from the hig component
const CYCLE_DURATION = 1000; // This value came from the hig componen

const NUM_SIDES = 10; // Number of sides for the loading polygon spinner
const SIZE = 72;
const THICKNESS = 6.75;

const SPINNER_SCALE = 0.5;
export class ForgeLogoSpinner {
    constructor(viewer) {
        this.viewer = viewer;
        this.setGlobalManager(this.viewer.globalManager);
        this.domElement = null;
        this._step = this._step.bind(this);
    }

    createDom(container) {
        const _document = this.getDocument();
        this.domElement = _document.createElement('div');
        this.domElement.className = 'forge-spinner';
        this._initTransform = `translate(-50%, -50%) scale(${SPINNER_SCALE})`;
        this.domElement.style.transform = this._initTransform.slice();
        var svg = this._createSvgElement('svg');
        svg.setAttribute('width', '242');
        svg.setAttribute('height', '242');
        svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
        svg.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:xlink', 'http://www.w3.org/1999/xlink');
        this.domElement.appendChild(svg);

        // Create the outer and inner polygon points
        var data = this._createWheelPointData(NUM_SIDES, SIZE, THICKNESS);

        this._createMask(data);

        // Add the first polygon to the svg. This is the same as the outer polygon in the image mask
        var firstPolygon = this._createSvgElement('polygon');
        firstPolygon.setAttribute('mask', 'url(#mask)');
        svg.appendChild(firstPolygon);
        this._addPoints(data.outerPoints, firstPolygon);

        // Create the colored segments. There will be 2 * NUM_SIDES number of segments
        this._createSegments(data);

        var img = _document.createElement('img');
        img.src = Autodesk.Viewing.Private.getResourceUrl('res/ui/forge-logo.png');
        this._onResize = this._onResize.bind(this);
        // Add the resize event listener once the forge logo image is loaded.
        img.onload = () => {
            // Initial resize when the forge logo png is loaded.
            // The _onResize method requires the bounding box of the spinner wrapper
            this._onResize();
            this._initResize = true;
            this.viewer.addEventListener(Autodesk.Viewing.VIEWER_RESIZE_EVENT, this._onResize);
        };
        this.domElement.appendChild(img);
        container && container.appendChild(this.domElement);
        this.domElement.style.display = 'none';

        return this.domElement;
    }

    /**
     * Creates a svg element.
     * @param {String} tag - element tag
     * @private
     */
    _createSvgElement(tag) {
        const _document = this.getDocument();
        return _document.createElementNS('http://www.w3.org/2000/svg', tag);
    }

    /**
     * Returns the SVG element
     * @private
     */
    _getSvg() {
        return this?.domElement.getElementsByTagNameNS('http://www.w3.org/2000/svg', 'svg')[0];
    }

    /**
     * Creates an SVG mask for the polygon progress wheel. This will make the inner polygon transparent.
     * @param {*} data
     * @private
     */
    _createMask(data) {
        const svg = this._getSvg();
        const defs = this._createSvgElement('defs');
        const mask = this._createSvgElement('mask');
        mask.id = 'mask';

        defs.appendChild(mask);
        svg.appendChild(defs);
        // Create the outer polygon for the mask
        const polygon = this._createSvgElement('polygon');
        polygon.style['opacity'] = 0.15;
        polygon.style['fill'] = '#FFF';
        mask.appendChild(polygon);
        this._addPoints(data.outerPoints, polygon);

        // Create the inner polygon for the mask
        const endPolygon = this._createSvgElement('polygon');
        mask.appendChild(endPolygon);
        this._addPoints(data.innerPoints, endPolygon);
    }

    /**
     * Animation function
     * @param {Number} timestamp
     * @private
     */
    _step(timestamp) {
        if (!this.startTime) this.startTime = timestamp;
        const elapsed = timestamp - this.startTime;
        const elapsedThisCycle = elapsed % CYCLE_DURATION;

        this._setSegmentOpacities(elapsedThisCycle);
        const _window = this.getWindow();

        this._animId = _window.requestAnimationFrame(this._step);
    }

    _stop() {
        if (this._animId) {
            // Stop the animation
            const _window = this.getWindow();
            _window.cancelAnimationFrame(this._animId);
            this._animId = null;
        }
    }

    /**
     * Set the opacity of the triangular segments
     * @param {*} elapsedThisCycle
     * @private
     */
    _setSegmentOpacities(elapsedThisCycle) {
        this.segments.forEach((segment, i) => {
            const index = Math.abs(i - this.segments.length) - 1;
            const eachSegment = segment;

            eachSegment.style.opacity = this._getSegmentOpacity(index, elapsedThisCycle);
        });
    }

    /**
     * Calculate the segment's opacity value
     * @param {*} index
     * @param {*} elapsedThisCycle
     * @private
     */
    _getSegmentOpacity(index, elapsedThisCycle) {
        const segmentFadeStartTime = index * (CYCLE_DURATION / this.segments.length);

        // Fade continuing from previous cycle
        if (segmentFadeStartTime + FADE_DURATION > CYCLE_DURATION && elapsedThisCycle < FADE_DURATION) {
            return ((elapsedThisCycle + CYCLE_DURATION - segmentFadeStartTime) / FADE_DURATION - 1) * -1;
        }

        // Fade has finished
        if (elapsedThisCycle < segmentFadeStartTime || elapsedThisCycle > segmentFadeStartTime + FADE_DURATION) {
            return 0;
        }

        // Fading
        return Math.abs((elapsedThisCycle - segmentFadeStartTime) / FADE_DURATION - 1);
    }

    /**
     * Returns an array of segement elements.
     * @private
     */
    _getSegments() {
        return Array.from(this.domElement.querySelectorAll('.segment'));
    }

    /**
     * Adds points to the supplied polygon
     * @param {Number[][]} points - Matrix of points
     * @param {SVGPolygonElement} polygon - polygon element
     * @private
     */
    _addPoints(points, polygon) {
        for (let value of points) {
            const svg = this._getSvg();
            const point = svg.createSVGPoint();
            point.x = value[0];
            point.y = value[1];
            polygon.points.appendItem(point);
        }
    }

    /**
     * Creates a polygon with numSides, size and thickness of the polygon.
     * @param {Number} numSides
     * @param {Number} size
     * @param {Number} thickness
     * @returns {Object} - data object containing the outerPolygon and innerPolygon points.
     * @private
     */
    _createWheelPointData(numSides, size, thickness = 5) {
        const center = size / 2;
        const Xcenter = size / 2;
        const Ycenter = size / 2;
        const data = { outerPoints: [], innerPoints: [] };
        for (let i = 1; i <= numSides; i++) {
            data.outerPoints.push([
                Xcenter + center * Math.cos((i * 2 * Math.PI) / numSides),
                Ycenter + center * Math.sin((i * 2 * Math.PI) / numSides),
            ]);

            data.innerPoints.push([
                Xcenter + (center - thickness) * Math.cos((i * 2 * Math.PI) / numSides),
                Ycenter + (center - thickness) * Math.sin((i * 2 * Math.PI) / numSides),
            ]);
        }
        return data;
    }

    /**
     * Creates colored triangles inside of the wheel polygon
     * @param {Object} data - returned value from _createWheelPointData
     * @private
     */
    _createSegments(data) {
        const { outerPoints, innerPoints } = data;
        const svg = this._getSvg();
        const createSegmentPolygon = (points, cssClass) => {
            var polygon = this._createSvgElement('polygon');
            addClass(polygon, 'segment');
            addClass(polygon, cssClass);
            this._addPoints(points, polygon);
            svg.appendChild(polygon);
        };

        // Iterate over the polygons points and create two triangles for each polygon side.
        for (let i = outerPoints.length - 1; i >= 0; --i) {
            let p1 = outerPoints[i],
                p2 = outerPoints[i - 1],
                p3 = innerPoints[i],
                p4 = innerPoints[i - 1];

            if (i === 0) {
                p2 = outerPoints[outerPoints.length - 1];
                p4 = innerPoints[outerPoints.length - 1];
            }

            createSegmentPolygon([p1, p2, p3], 'light-blue');
            createSegmentPolygon([p3, p4, p2], 'dark-blue');
        }
    }

    /**
     * Fade the domElement out.
     * @private
     */
    _fadeOut() {
        let opacity = 1; // initial opacity
        const timer = setInterval(() => {
            if (!this.domElement?.style) {
                clearInterval(timer);
                return;
            }

            if (opacity <= 0.1) {
                clearInterval(timer);
                this.domElement.style.display = 'none';
            }
            this.domElement.style.opacity = opacity;
            opacity -= opacity * 0.1;
        }, 1);
    }

    show() {
        if (this.domElement) {
            this.domElement.style.display = 'block';
            this.domElement.style.opacity = 1;
            this.segments = this._getSegments();
            this._step(1);
        }
    }

    hide() {
        if (this.domElement) {
            this._hide = (event) => {
                // Stop the spinner
                this._stop();
                if (event.model.is3d()) {
                    // Fade the spinner out
                    this._fadeOut();
                } else {
                    // For 2d, the model is loaded right away.
                    this.domElement.style.opacity = 0;
                    this.domElement.style.display = 'none';
                }
            };

            var models = this.viewer.impl.modelQueue().getModels();
            if (models.length === 0) {
                // Add an event listener
                this.viewer.addEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, this._hide, {once: true});
            } else {
                this._hide({model: models[0]});
            }
        }
    }

    destroy() {
        this._stop();
        if (this.domElement?.parentElement) {
            this.domElement.parentElement.removeChild(this.domElement);
        }
        this.domElement = null;
        this.viewer.removeEventListener(Autodesk.Viewing.VIEWER_RESIZE_EVENT, this._onResize);
    }

    _onResize() {
        if (this._initResize) {
            this._initResize = false;
            return;
        }
        const spinner = this.domElement;
        if (!spinner) return;

        // Do not calculate the scale when the spinner is not visible
        if (spinner.style.display == 'none') return;

        const parent = spinner.parentElement;
        if (!parent) return;

        const parentBB = parent.getBoundingClientRect();
        const spinnerBB = spinner.getBoundingClientRect();
        
        const tolerance = Math.max(spinnerBB.width / parentBB.width, (spinnerBB.height + 350) / parentBB.height);

        const transform = this.domElement?.style?.transform;
        if (!transform) return;

        if (tolerance > 0.8) {
            const regex = /[-+]?scale\(\d*\.\d+|\d+\)/;
            const scale = regex.exec(transform);
            // Check if the scale is present
            if (scale.length > 0) {
                const val = scale[0].split('scale(')[1];
                const newScale = Number((val / tolerance).toFixed(4));
                const newTransform = transform.replace(regex, `scale(${newScale}`);
                // Only apply the transform if it is not the same and if the new scale is less than the original scale
                if (newTransform != this.domElement.style.transform && newScale <= SPINNER_SCALE && newScale > 0.2) {
                    this.domElement.style.transform = newTransform;
                }
            }
        } else if (this.domElement.style.transform != this._initTransform) {
            this.domElement.style.transform = this._initTransform;
        }
    }
}

function addClass(elm, cssClass) {
    if (elm.classList) {
        elm.classList.add(cssClass);
    } else {
        // https://caniuse.com/#search=classList
        // IE11 does not implement classList on <svg>
        let appliedClasses = elm.getAttribute('class') || '';
        appliedClasses = !appliedClasses.split(' ').includes(cssClass)
            ? `${appliedClasses} ${cssClass}`
            : appliedClasses;
        elm.setAttribute('class', appliedClasses);
    }
}

GlobalManagerMixin.call(ForgeLogoSpinner.prototype);
