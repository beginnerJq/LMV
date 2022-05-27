import {LmvBox3} from "../../../wgs/scene/LmvBox3";

function setFromArray(array, offset ) {

	this.min.x = array[offset];
	this.min.y = array[offset+1];
	this.min.z = array[offset+2];

	this.max.x = array[offset+3];
	this.max.y = array[offset+4];
	this.max.z = array[offset+5];
}

function copyToArray(array, offset) {

	array[offset]   = this.min.x;
	array[offset+1] = this.min.y;
	array[offset+2] = this.min.z;

	array[offset+3] = this.max.x;
	array[offset+4] = this.max.y;
	array[offset+5] = this.max.z;
}

//Overload of the default FragInfo, used with OTG-specific fragments_extra data file
//to initialize the BVH spatial index.
export function OtgFragInfo(data, loadContext) {

	var byteStride = data[1] << 8 | data[0];
	//var version = data[3] << 8 | data[2];

	if (!byteStride)
		byteStride = 7*4;

	this.boxStride = byteStride / 4;
	this.count = data.byteLength / byteStride - 1;

	//Global offset set by the viewer loader client
	let globalOffset = loadContext.globalOffset || { x:0, y:0, z:0 };

	//Internal double precision offset used in the OTG file format (always set as of November 2018)
	let fo = loadContext.fragmentTransformsOffset || { x:0, y:0, z:0 };

	if (this.count) {
		//make views directly into the first data record (skipping the header record)
		this.boxes = new Float32Array(data.buffer, byteStride);
		this.flags = new Int32Array(data.buffer, byteStride);

		//apply placement transform if given
		var boxes = this.boxes;

		if (loadContext.placementTransform) {
			var tmpBox = new LmvBox3();
			var offset = 0;
			for (var i=0; i<this.count; i++, offset += this.boxStride) {

				setFromArray.call(tmpBox, boxes, offset);

				//Add back the built-in OTG offset
				tmpBox.min.x += fo.x;
				tmpBox.min.y += fo.y;
				tmpBox.min.z += fo.z;
				tmpBox.max.x += fo.x;
				tmpBox.max.y += fo.y;
				tmpBox.max.z += fo.z;


				tmpBox.applyMatrix4(loadContext.placementWithOffset); //this will apply both placement and global offset at once

				copyToArray.call(tmpBox, boxes, offset);
			}
		} else {

			var ox = fo.x - globalOffset.x;
			var oy = fo.y - globalOffset.y;
			var oz = fo.z - globalOffset.z;

			//Faster code path when we only have global offset and no placement transform
			for (var i=0, offset=0; i<this.count; i++, offset += this.boxStride) {

				boxes[offset  ] += ox;
				boxes[offset+1] += oy;
				boxes[offset+2] += oz;

				boxes[offset+3] += ox;
				boxes[offset+4] += oy;
				boxes[offset+5] += oz;
			}
		}
	}

	this.hasPolygonCounts = true;
	this.wantSort = false;
}

OtgFragInfo.prototype.getCount = function() {
    return this.count;
};

OtgFragInfo.prototype.isTransparent = function(i) {
	var flags = this.flags[i*this.boxStride+6];
	return !!(flags >> 24);
};

OtgFragInfo.prototype.getPolygonCount = function(i) {
	var flags = this.flags[i*this.boxStride+6];
	return flags & 0xffffff;
};
