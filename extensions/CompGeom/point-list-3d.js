
import {TOL} from "./fuzzy-math";

const _tmp = {
    x:0,
    y:0,
    z:0
};

export class UniquePointList3D {

    constructor(getVertex, bbox, precisionTolerance) {

        this.getVertex = getVertex;
        this.bbox = bbox;
        this.boxSize = this.bbox.getSize().length();

        if (!precisionTolerance) {
            precisionTolerance = TOL;
        }
        if (precisionTolerance > 0) {
            //Input is in model units, e.g. if model is in feet,
            //precision tolerance has to be in feet
            this.precisionTolerance = precisionTolerance;
            this.scale = 1.0 / this.precisionTolerance;
        } else {
            //If negative, input precision is treated as relative to bounding box size
            this.precisionTolerance = -precisionTolerance * this.boxSize;
            this.scale = 1.0 / this.precisionTolerance;
        }

        this.snapBaseX = (this.bbox.min.x); ///- 0.5 * this.precisionTolerance;
        this.snapBaseY = (this.bbox.min.y); //- 0.5 * this.precisionTolerance;
        this.snapBaseZ = (this.bbox.min.z); //- 0.5 * this.precisionTolerance;

        this.xymap = {};
    }

    findOrAddPoint(px, py, pz, id) {

        //Snap the vertex to our desired granularity
        let x = 0 | /*Math.round*/((px - this.snapBaseX) * this.scale);
        let y = 0 | /*Math.round*/((py - this.snapBaseY) * this.scale);
        let z = 0 | /*Math.round*/((pz - this.snapBaseZ) * this.scale);

        //Find the nearest snapped vertex or create new
        let v;
        let minDist = Infinity;
        //Look in the 27 cube area surrounding the vertex
        for (let i=x-1; i<=x+1; i++) {
            let mx = this.xymap[i];
            if (!mx)
                continue;

            for (let j=y-1; j<=y+1; j++) {
                let my = mx[j];
                if (!my)
                    continue;

                for (let k=z-1; k<=z+1; k++) {

                    let tmpi = my[k];
                    if (tmpi === undefined)
                        continue;

                    this.getVertex(tmpi, _tmp);
                    let tmp = _tmp;
                    let dist = (tmp.x - px) * (tmp.x - px) + (tmp.y - py) * (tmp.y - py) + (tmp.z - pz) * (tmp.z - pz);

                    if (dist < minDist) {
                        v = tmpi;
                        minDist = dist;
                    }
                }
            }
        }

        if (Math.sqrt(minDist) > this.precisionTolerance)
            v = undefined;

        if (v === undefined) {
            let mx = this.xymap[x];
            if (!mx) {
                mx = this.xymap[x] = {};
            }

            let my = mx[y];
            if (!my) {
                my = mx[y] = {};
            }

            my[z] = id;
            return id;
        } else {
            return v;
        }
    }
}