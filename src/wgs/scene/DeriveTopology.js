import {enumMeshTriangles, enumMeshVertices, getVertexCount} from "./VertexEnumerator";
import {LmvVector3} from "./LmvVector3";
import {LmvBox3} from "./LmvBox3";
import {UniquePointList3D} from "../../../extensions/CompGeom/point-list-3d";

function getVertices(geom, bbox) {

    var vbuf = new Float32Array(3 * getVertexCount(geom));

    function cb(v, n, uv, i) {
        if (bbox) {
            bbox.expandByPoint(v);
        }
        vbuf[3*i] = v.x;
        vbuf[3*i+1] = v.y;
        vbuf[3*i+2] = v.z;
    }

    enumMeshVertices(geom, cb);

    return vbuf;
}

function transformVertices(verts, toWorld) {

    let _v1 = new LmvVector3();

    for (let i=0; i<verts.length; i+=3) {
        _v1.x = verts[i];
        _v1.y = verts[i+1];
        _v1.z = verts[i+2];

        _v1.applyMatrix4(toWorld);

        verts[i] = _v1.x;
        verts[i+1] = _v1.y;
        verts[i+2] = _v1.z;
    }
}

let _v1 = new LmvVector3();
let _v2 = new LmvVector3();
let _v3 = new LmvVector3();
let _n1 = new LmvVector3();
let _n2 = new LmvVector3();

export class MeshAccessor {

    constructor(geom, toWorld, boundingBox) {

        let inBox = geom.boundingBox || boundingBox;
        let box = new LmvBox3();
        if (inBox) {
            box.copy(inBox);
        }

        this.geom = geom;
        this.myVerts = getVertices(geom, inBox ? null : box);

        //de-duplicate vertices based on position only (ignoring normals)
        let upl = new UniquePointList3D(this.getV.bind(this), box, -1.0/(1<<16));
        this.remap = new Array(getVertexCount(geom));
        for (let i=0,j=0; i<this.myVerts.length; i+=3,j++) {
            this.remap[j] = upl.findOrAddPoint(this.myVerts[i], this.myVerts[i+1], this.myVerts[i+2], j);
        }
/*
        let remap = new Array(getVertexCount(geom));
        for (let i=0,j=0; i<worldVerts.length; i+=3,j++) {
            remap[j] = j;
        }
*/

        //get vertices into world space -- we need this for
        //correct angle calculations (in case there is non-uniform scaling, etc)
        if (toWorld) {
            transformVertices(this.myVerts, toWorld);
        }

    }

    getV(i, v) {
        v.x = this.myVerts[3*i];
        v.y = this.myVerts[3*i+1];
        v.z = this.myVerts[3*i+2];
    }

    getNormal(i1, i2, i3, n) {
        this.getV(i1, _v1);
        this.getV(i2, _v2);
        this.getV(i3, _v3);

        _v2.sub(_v1);
        _v3.sub(_v1);
        _v2.cross(_v3);

        n.copy(_v2).normalize();
    }
}


export function createWireframe(geom, toWorld, boundingBox, wantAllTriangleEdges) {

    if (geom.isLines)
        return;

    if (geom.iblines)
        return;


    let mt = new MeshAccessor(geom, toWorld, boundingBox);

    //loop over all triangles, keeping track of
    //edges that seem important
    var seenEdges = {};

    var edgeIB = [];

    function doOneEdge(i1orig, i2orig, opp1orig) {

        var i1 = mt.remap[i1orig];
        var i2 = mt.remap[i2orig];
        var opp1 = mt.remap[opp1orig];

        //Ignore degenerates
        if (i1 === i2 || i1 === opp1 || i2 === opp1)
            return;

        var reversed = false;
        if (i1 > i2) {
            var tmp = i1;
            i1 = i2;
            i2 = tmp;
            reversed = true;
        }

        var e1 = seenEdges[i1];
        if (e1) {
            var opp2orig = e1[i2];
            if (opp2orig === undefined) {
                e1[i2] = reversed ? -opp1orig-1 : opp1orig;
            } else {
                //We now know two triangles that share this edge,
                //we can check if it's important

                if (!wantAllTriangleEdges) {
                    //Use original indices, so that we
                    //can do the math with the correct winding order
                    mt.getNormal(i1orig, i2orig, opp1orig, _n1);

                    if (opp2orig < 0) {
                        mt.getNormal(i2, i1, mt.remap[-opp2orig-1], _n2);
                    } else {
                        mt.getNormal(i1, i2, mt.remap[opp2orig], _n2);
                    }

                    var dot = _n1.dot(_n2);

                    if (Math.abs(dot) < 0.25) {
                        edgeIB.push(i1orig);
                        edgeIB.push(i2orig);
                    }
                } else {
                    edgeIB.push(i1orig);
                    edgeIB.push(i2orig);
                }

                delete e1[i2];
            }
        } else {
            seenEdges[i1] = {};
            seenEdges[i1][i2] = opp1orig;
        }
    }

    function tricb(vA, vB, vC, iA, iB, iC) {
        doOneEdge(iA, iB, iC);
        doOneEdge(iB, iC, iA);
        doOneEdge(iC, iA, iB);
    }

    //find edges that have neighboring triangles at sharp angle
    enumMeshTriangles(geom, tricb);

    //process remaining edges (outer edges that only have one triangle)

    for (var i1 in seenEdges) {
        for (var i2 in seenEdges[i1]) {
            edgeIB.push(parseInt(i1));
            edgeIB.push(parseInt(i2));
        }
    }


    if (edgeIB.length > 1) {
        geom.iblines = new Uint16Array(edgeIB.length);
        geom.iblines.set(edgeIB);
    }

/*
    for (var i=0; i<geom.ib.length; i++) {
        geom.ib[i] = remap[geom.ib[i]];
    }
    */
}
