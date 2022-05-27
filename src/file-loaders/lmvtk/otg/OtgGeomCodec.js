
import { isNodeJS } from "../../../compat";
import { InputStream } from "../common/InputStream";
import { LmvBox3 } from "../../../wgs/scene/LmvBox3";

/*
Integers encoded in *little endian*

Magic header: LMV0 (4 bytes)
Flags: 2 bytes (isLine, isPoint, isWideLine, etc.)
Num buffers: 1 byte
Num attributes: 1 byte (attributes are fixed size)
Buf Offsets (from beginning of data block, first buffer is always at 0, so is skipped): 4 bytes each
Attributes: {
	Name: 1 byte enum (Index, IndexEdges, Position, Normal, TextureUV, Color)
	itemSize: 1/2 byte low nibble (must be 1,2,3 or 4)
	itemType: 1/2 byte hi nibble (BYTE, SHORT, UBYTE, USHORT, FLOAT ...)
	itemOffset: 1 byte (in bytes)
	itemStride: 1 byte (stride in bytes)
	buffer Idx: 1 bytes
} (5 bytes each)

(padding bytes to make data stream offset a multiple of 4)

Data: binary, concatenated vertex and index streams
*/

const AttributeName = {
	Index: 		0,
	IndexEdges: 1,
	Position: 	2,
	Normal: 	3,
	TextureUV: 	4,
	Color: 		5
};

const AttributeType = {
	BYTE: 		0,
	SHORT: 		1,
	UBYTE: 		2,
	USHORT: 	3,

	BYTE_NORM: 	4,
	SHORT_NORM: 5,
	UBYTE_NORM: 6,
	USHORT_NORM:7,

	FLOAT: 		8,
	INT: 		9,
	UINT: 		10
	//DOUBLE: 11
};


const MeshFlags = {
	//NOTE: Lower two bits are NOT A BITMASK!!!
	TRIANGLES: 	0,
	LINES: 		1,
	POINTS: 	2,
	WIDE_LINES: 3,


};


const LMV2OTGAttr = {
	"position" : AttributeName.Position,
	"normal": AttributeName.Normal,
	"index" : AttributeName.Index,
	"indexlines": AttributeName.IndexEdges,
	"color": AttributeName.Color
};

const OTG2LMVAttr = {};
OTG2LMVAttr[AttributeName.Position] = "position";
OTG2LMVAttr[AttributeName.Normal] = "normal";
OTG2LMVAttr[AttributeName.Index] = "index";
OTG2LMVAttr[AttributeName.IndexEdges] = "indexlines";
OTG2LMVAttr[AttributeName.Color] = "color";
OTG2LMVAttr[AttributeName.TextureUV] = "uv";


const AttributeTypeToSize = {};
AttributeTypeToSize[AttributeType.BYTE] = 1;
AttributeTypeToSize[AttributeType.SHORT] = 2;
AttributeTypeToSize[AttributeType.UBYTE] = 1;
AttributeTypeToSize[AttributeType.USHORT] = 2;
AttributeTypeToSize[AttributeType.BYTE_NORM] = 1;
AttributeTypeToSize[AttributeType.SHORT_NORM] = 2;
AttributeTypeToSize[AttributeType.UBYTE_NORM] = 1;
AttributeTypeToSize[AttributeType.USHORT_NORM] = 2;
AttributeTypeToSize[AttributeType.FLOAT] = 4;
AttributeTypeToSize[AttributeType.INT] = 4;
AttributeTypeToSize[AttributeType.UINT] = 4;
//DOUBLE: 11



function rotate(tri) {
	var tmp = tri[0];
	tri[0] = tri[1];
	tri[1] = tri[2];
	tri[2] = tmp;
}

function deltaEncodeIndexBuffer3(ib) {

	var triangles = [];

	for (var i=0; i<ib.length; i+=3) {
		triangles.push(
			[ib[i], ib[i+1], ib[i+2]]
		);
	}

	//Sort the indices for each triangle so that
	//the first one is smallest
	for (var i=0; i<triangles.length; i++) {
		var t = triangles[i];

		while (t[0] > t[1] || t[0] > t[2]) {
			rotate(t);
		}
	}

	//Sort triangles by ascending first index
	triangles.sort(function(a, b){
		return a[0] - b[0]; 
	});

	//Delta encode the indices
	var t = triangles[0];
	var j = 0;
	ib[j] = t[0];
	ib[j+1] = t[1] - t[0];
	ib[j+2] = t[2] - t[0];
	j += 3;

	for (var i=1; i<triangles.length; i++, j+=3) {
		t = triangles[i];

		ib[j] = t[0] - triangles[i-1][0];
		ib[j+1] = t[1] - t[0];
		ib[j+2] = t[2] - t[0];
	}

}

function deltaEncodeIndexBuffer2(ib) {

	var lines = [];

	for (var i=0; i<ib.length; i+=2) {
		lines.push(
			[ib[i], ib[i+1]]
		);
	}

	//Sort the indices for each triangle so that
	//the first one is smallest
	for (var i=0; i<lines.length; i++) {
		var t = lines[i];

		if (t[0] > t[1]) {
			var tmp = t[0];
			t[0] = t[1];
			t[1] = tmp;
		}
	}

	//Sort lines by ascending first index
	lines.sort(function(a, b){
		return a[0] - b[0]; 
	});

	//Delta encode the indices
	var t = lines[0];
	var j = 0;
	ib[j] = t[0];
	ib[j+1] = t[1] - t[0];
	j += 2;

	for (var i=1; i<lines.length; i++, j+=2) {
		t = lines[i];

		ib[j] = t[0] - lines[i-1][0];
		ib[j+1] = t[1] - t[0];
	}

}


function deltaDecodeIndexBuffer3(ib) {

	if (!ib.length)
		return;

	ib[1] += ib[0];
	ib[2] += ib[0];

	for (var i=3; i<ib.length; i+=3) {
		ib[i] += ib[i-3];
		ib[i+1] += ib[i];
		ib[i+2] += ib[i];
	}
}

function deltaDecodeIndexBuffer2(ib) {

	if (!ib.length)
		return;

	ib[1] += ib[0];

	for (var i=2; i<ib.length; i+=2) {
		ib[i] += ib[i-2];
		ib[i+1] += ib[i];
	}
}

function attrNameMapper(attributeName) {

	var name = LMV2OTGAttr[attributeName];
	if (typeof name !== "undefined")
		return name;

	if (attributeName.indexOf("uv") === 0) {
		return AttributeName.TextureUV;
	}

	console.warn("Unknown attribute name");
	return AttributeName.TextureUV;
}


function attrNameToLMV(attrName) {

	var lmvAttr = OTG2LMVAttr[attrName];
	if (lmvAttr)
		return lmvAttr;

	console.error("Unknown vertex attribute");
	return AttributeName.TextureUV;
}


function attrTypeMapper(attr) {

	var type = AttributeType.FLOAT;

	var itemWidth = attr.bytesPerItem || 4;
	if (itemWidth === 1) {
		type = attr.normalized ? AttributeType.UBYTE_NORM : AttributeType.UBYTE;
	} else if (itemWidth === 2) {
		type = attr.normalized ? AttributeType.USHORT_NORM : AttributeType.USHORT;
	}
	
	return (type << 4) | (attr.itemSize & 0xf);
}

function indexTypeMapper(attr) {
	var type = AttributeType.USHORT;

	var itemWidth = attr.bytesPerItem || 2;
	if (itemWidth === 1) {
		type = AttributeType.UBYTE;
	} else if (itemWidth === 2) {
		type = AttributeType.USHORT;
	} else if (itemWidth === 4) {
		type = AttributeType.UINT;
	}

	return (type << 4) | (attr.itemSize & 0xf);
}


function OtgGeomEncoder() {
}


OtgGeomEncoder.prototype.beginHeader = function(meshFlag, numAttributes, dataStreamLengths) {
	var headerSize = 8;

	var numBuffers = dataStreamLengths.length;
	headerSize += (numBuffers - 1) * 4; 

	headerSize += numAttributes * 5;

	while (headerSize % 4 !== 0) {
		headerSize++;
	}

	var totalDataSize = 0;
	for (var i=0; i<dataStreamLengths.length; i++)
		totalDataSize += dataStreamLengths[i];

	this.buffer = Buffer.alloc(headerSize + totalDataSize);
	this.writeOffset = 0;

	//Write the 4 byte magic prefix
	const MAGIC = "OTG0";
	for (var i=0; i<4; i++) {
		this.writeOffset = this.buffer.writeUInt8(MAGIC.charCodeAt(i), this.writeOffset);
	}

	//TODO: line width if wide lines and pointSize if points

	this.writeOffset = this.buffer.writeUInt16LE(meshFlag, this.writeOffset);

	this.writeOffset = this.buffer.writeUInt8(numBuffers, this.writeOffset);

	this.writeOffset = this.buffer.writeUInt8(numAttributes, this.writeOffset);

	//write buffer offsets from the beginning of the binary data block
	//Skip the first buffer as its at offset zero
	var offset = dataStreamLengths[0];
	for (var i=1; i<dataStreamLengths.length; i++) {
		this.writeOffset = this.buffer.writeUInt32LE(offset, this.writeOffset);
		offset += dataStreamLengths[i];
	}
};

OtgGeomEncoder.prototype.addAttribute = function(attrName, attr, stride, bufferIndex) {
	this.writeOffset = this.buffer.writeUInt8(attrName, this.writeOffset);

	if (attrName === AttributeName.Index || attrName === AttributeName.IndexEdges) {

		this.writeOffset = this.buffer.writeUInt8(indexTypeMapper(attr), this.writeOffset);

		this.writeOffset = this.buffer.writeUInt8((attr.itemOffset || 0) * 4, this.writeOffset); //itemOffset
		this.writeOffset = this.buffer.writeUInt8((stride || 0) * 4, this.writeOffset); //itemStride

		this.writeOffset = this.buffer.writeUInt8(bufferIndex, this.writeOffset); //buffer index
	} else {
		this.writeOffset = this.buffer.writeUInt8(attrTypeMapper(attr), this.writeOffset);

		this.writeOffset = this.buffer.writeUInt8((attr.itemOffset || 0) * 4, this.writeOffset); //itemOffset (LMV stores in multiples of 4)
		this.writeOffset = this.buffer.writeUInt8((stride || 0) * 4, this.writeOffset); //itemStride (LMV stores in multiples of 4)

		this.writeOffset = this.buffer.writeUInt8(bufferIndex, this.writeOffset); //buffer index
	}
};


OtgGeomEncoder.prototype.endHeader = function() {
	//Padding so that buffers are written at multiple of 4
	while (this.writeOffset % 4 !== 0) {
		this.writeOffset = this.buffer.writeUInt8(0, this.writeOffset);
	}
};

OtgGeomEncoder.prototype.addBuffer = function(buffer) {
	buffer.copy(this.buffer, this.writeOffset);
	this.writeOffset += buffer.length;
};


OtgGeomEncoder.prototype.end = function() {
	if (this.writeOffset !== this.buffer.length) {
		console.error("Incorrect encoding buffer size");
	}

	return this.buffer;
};



function OtgGeomDecoder(buf) {

	this.buffer = buf;
	this.readOffset = 0;

	this.meshFlag = 0;
	this.numBuffers = 0;
	this.numAttributes = 0;
	this.bufferOffsets = [];
	this.attributes = [];
	this.buffers = [];
}


OtgGeomDecoder.prototype.readNodeJS = function() {

	var magic = this.buffer.toString("ascii", 0, 4);
	if (magic !== "OTG0") {
		console.error("Invalid OTG header");
		return false;
	}

	this.readOffset = 4;

	this.meshFlag = this.buffer.readUInt16LE(this.readOffset);
	this.readOffset += 2;

	this.numBuffers = this.buffer.readUInt8(this.readOffset);
	this.readOffset++;

	this.numAttributes = this.buffer.readUInt8(this.readOffset);
	this.readOffset++;

	if (this.numBuffers) {
		this.bufferOffsets.push(0);

		for (var i=1; i<this.numBuffers; i++) {
			var boff = this.buffer.readUInt32LE(this.readOffset);
			this.readOffset += 4;
			this.bufferOffsets.push(boff);
		}
	}

	for (var i=0; i<this.numAttributes; i++) {
		var attr = {};

		attr.name = this.buffer.readUInt8(this.readOffset);
		this.readOffset++;

		var type = this.buffer.readUInt8(this.readOffset);
		this.readOffset++;

		attr.itemSize = type & 0xf;
		attr.type = type >> 4;

		attr.bytesPerItem = AttributeTypeToSize[attr.type];

		attr.normalized = (attr.type === AttributeType.BYTE_NORM || 
						  attr.type === AttributeType.SHORT_NORM ||
						  attr.type === AttributeType.UBYTE_NORM ||
						  attr.type === AttributeType.USHORT_NORM
						  ); 

		attr.itemOffset = this.buffer.readUInt8(this.readOffset) / 4;
		this.readOffset++;

		attr.itemStride = this.buffer.readUInt8(this.readOffset) / 4;
		this.readOffset++;

		attr.bufferIndex = this.buffer.readUInt8(this.readOffset);
		this.readOffset++; 

		this.attributes.push(attr);
	}

	//seek to the beginning of the buffer data
	while(this.readOffset % 4 !== 0)
		this.readOffset++;

	for (var i=0; i<this.bufferOffsets.length; i++) {

		var startOffset = this.readOffset + this.bufferOffsets[i];
		var endOffset;

		if (i < this.bufferOffsets.length - 1) {
			endOffset = this.readOffset + this.bufferOffsets[i+1];
		} else {
			endOffset = this.buffer.length;
		}

		this.buffers.push(this.buffer.slice(startOffset, endOffset));
	}

	return true;
};


OtgGeomDecoder.prototype.readWeb = function() {

	var stream = new InputStream(this.buffer);

	var magic = stream.getString(4);
	if (magic !== "OTG0") {
		console.error("Invalid OTG header");
		return false;
	}


	this.meshFlag = stream.getUint16();
	this.numBuffers = stream.getUint8();
	this.numAttributes = stream.getUint8();

	if (this.numBuffers) {
		this.bufferOffsets.push(0);

		for (var i=1; i<this.numBuffers; i++) {
			var boff = stream.getUint32();
			this.bufferOffsets.push(boff);
		}
	}

	for (var i=0; i<this.numAttributes; i++) {
		var attr = {};

		attr.name = stream.getUint8();

		var type = stream.getUint8();

		attr.itemSize = type & 0xf;
		attr.type = type >> 4;

		attr.bytesPerItem = AttributeTypeToSize[attr.type];

		attr.normalized = (attr.type === AttributeType.BYTE_NORM ||
						  attr.type === AttributeType.SHORT_NORM ||
						  attr.type === AttributeType.UBYTE_NORM ||
						  attr.type === AttributeType.USHORT_NORM
						  );

		attr.itemOffset = stream.getUint8() / 4;

		attr.itemStride = stream.getUint8() / 4;

		attr.bufferIndex = stream.getUint8();

		this.attributes.push(attr);
	}

	//seek to the beginning of the buffer data
	while(stream.offset % 4 !== 0)
		stream.offset++;

	for (var i=0; i<this.bufferOffsets.length; i++) {

		var startOffset = stream.offset + this.bufferOffsets[i];
		var endOffset;

		if (i < this.bufferOffsets.length - 1) {
			endOffset = stream.offset + this.bufferOffsets[i+1];
		} else {
			endOffset = stream.byteLength;
		}

		this.buffers.push(this.buffer.subarray(startOffset, endOffset));
	}

	return true;
};


OtgGeomDecoder.prototype.read = function() {

	if (isNodeJS() && this.buffer instanceof Buffer) {
		return this.readNodeJS();
	} else {
		return this.readWeb();
	}
};



export function serializeLmvBufferGeom(geom) {

	var otgEncoder = new OtgGeomEncoder();

	//Check for interleaved buffer. For now
	//this is the only one we support
	var bufSizes = [];
	if (!geom.vb) {
		console.error("Unexpected non-interleaved vertex buffer");
		return null;
	} else {
		bufSizes = [geom.vb.byteLength, geom.ib.byteLength];
		
		if (geom.iblines) {
			bufSizes.push(geom.iblines.byteLength);
		}
	}

	var attrKeys = Object.keys(geom.attributes);

	var meshFlag = 0;
	if (geom.isLines)
		meshFlag = meshFlag | MeshFlags.LINES;
	if (geom.isWideLines)
		meshFlag = meshFlag | MeshFlags.WIDE_LINES;
	if (geom.isPoints)		
		meshFlag = meshFlag | MeshFlags.POINTS;

	otgEncoder.beginHeader(meshFlag, attrKeys.length, bufSizes);

	//Write the attributes
	for (var i=0; i<attrKeys.length; i++) {
		var attr = geom.attributes[attrKeys[i]];
		var attrName = attrNameMapper(attrKeys[i]);

		if (attrKeys[i] === "index") {
			otgEncoder.addAttribute(attrName, attr, 0, 1);
		} else if (attrKeys[i] === "indexlines") {
			otgEncoder.addAttribute(attrName, attr, 0, 2);
		} else {
			otgEncoder.addAttribute(attrName, attr, geom.vbstride, 0);
		}

	}

	otgEncoder.endHeader();

	//Write the buffers

	//Buffer 0
	var tmp = Buffer.from(geom.vb.buffer, geom.vb.byteOffset, geom.vb.byteLength);
	otgEncoder.addBuffer(tmp);

	//Buffer 1
	if (geom.isLines)
		deltaEncodeIndexBuffer2(geom.ib);
	else
		deltaEncodeIndexBuffer3(geom.ib);

	tmp = Buffer.from(geom.ib.buffer, geom.ib.byteOffset, geom.ib.byteLength);
	otgEncoder.addBuffer(tmp);

	//Buffer 2
	if (geom.iblines) {
		deltaEncodeIndexBuffer2(geom.iblines);

		tmp = Buffer.from(geom.iblines.buffer, geom.iblines.byteOffset, geom.iblines.byteLength);
		otgEncoder.addBuffer(tmp);
	}

	var buf = otgEncoder.end();

	return buf;
}



var unitBox = new LmvBox3();
unitBox.min.x = -0.5;
unitBox.min.y = -0.5;
unitBox.min.z = -0.5;
unitBox.max.x = 0.5;
unitBox.max.y = 0.5;
unitBox.max.z = 0.5;

//var unitSphere = new THREE.Sphere();
//unitSphere.radius = Math.sqrt(0.5 * 0.5 * 3);
var unitSphere = {
	center: { x:0, y:0, z:0},
	radius: Math.sqrt(0.5 * 0.5 * 3)
};

export function readLmvBufferGeom(buffer, skipEdges) {

	var dec = new OtgGeomDecoder(buffer);

	if (!dec.read()) {
		console.error("Failed to parse OTG geometry");
		return null;
	}

	//Assumes the interleaved buffer serialization we use by default
	//Maps the decoded data to the mdata/vblayout structures produced by
	//the LMV loader worker threads. It's slightly different from the LmvBufferGeometry fields
	var mesh = {
		vblayout: {},
		vb: new Float32Array(dec.buffers[0].buffer, dec.buffers[0].byteOffset, dec.buffers[0].byteLength / 4),
		isLines: (dec.meshFlag & 0x3) === MeshFlags.LINES,
		isWideLines: (dec.meshFlag & 0x3) === MeshFlags.WIDE_LINES,
		isPoints: (dec.meshFlag & 0x3) === MeshFlags.POINTS,
		boundingBox: unitBox,
		boundingSphere: unitSphere
	};

	//TODO: line width

	for (var i=0; i<dec.attributes.length; i++) {
		var attr = dec.attributes[i];

		if (attr.name === AttributeName.Index) {
			var ib = dec.buffers[1];
			if (attr.bytesPerItem === 1) {
				mesh.indices = ib;
			} else if (attr.bytesPerItem === 2) {
				mesh.indices = new Uint16Array(ib.buffer, ib.byteOffset, ib.byteLength / attr.bytesPerItem);
			} else if (attr.bytesPerItem === 4) {
				mesh.indices = new Uint32Array(ib.buffer, ib.byteOffset, ib.byteLength / attr.bytesPerItem);
			}

			if (mesh.isLines)
				deltaDecodeIndexBuffer2(mesh.indices);
			else	
				deltaDecodeIndexBuffer3(mesh.indices);
		} else if (attr.name === AttributeName.IndexEdges) {
			if (!skipEdges) {
				var iblines = dec.buffers[2];
				if (attr.bytesPerItem === 1) {
					mesh.iblines = iblines;
				} else if (attr.bytesPerItem === 2) {
					mesh.iblines = new Uint16Array(iblines.buffer, iblines.byteOffset, iblines.byteLength / attr.bytesPerItem);
				} else if (attr.bytesPerItem === 4) {
					mesh.iblines = new Uint32Array(iblines.buffer, iblines.byteOffset, iblines.byteLength / attr.bytesPerItem);
				}

				deltaDecodeIndexBuffer2(mesh.iblines);
			}
		} else {
			var lmvAttr = attrNameToLMV(attr.name);

			if (!mesh.vbstride)
				mesh.vbstride = attr.itemStride;
			else {
				//We expect all vertex attributes to be packed into one VB 
				if (mesh.vbstride !== attr.itemStride)
					console.error("Unexpected vertex buffer stride mismatch.");
			}

			if (attr.itemOffset >= attr.itemStride) {
				//Some old (pre- October 2018) meshes have an extra UV attribute defined even though
				//it's not physically in the vertex buffer data. We skip it here.
				//If the attribute offset is out of bounds, we just ignore it.
				//console.warn("Buggy OTG mesh. Ignoring out of bounds attribute");
			} else {
				mesh.vblayout[lmvAttr] = {
					bytesPerItem: attr.bytesPerItem,
					offset: attr.itemOffset,
					normalized: attr.normalized,
					itemSize: attr.itemSize
				};
			}
		}

	}

	var mdata = {
		mesh: mesh,
		packId: 0,
		meshIndex: 0
	};

	return mdata;

}
