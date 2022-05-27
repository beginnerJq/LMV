import { ViewingService as ViewingService } from "../net/Xhr";
import { BVHBuilder as BVHBuilder } from "../../wgs/scene/BVHBuilder";
import { OtgFragInfo } from "../lmvtk/otg/OtgFragInfo";

function loadAsyncResource(loadContext, resourcePath, responseType, callback) {

	ViewingService.getItem(loadContext, resourcePath,
							callback,
							loadContext.onFailureCallback,
								{
									responseType:responseType || "arraybuffer"
								}
							);

}

function doLoadOtgBvh(loadContext) {

	//TODO: We could process bboxes progressively (in the OtgFragInfo constructions) instead of doing it once the whole file is in
	//although it's probably not worth it, given we are reunning in a worker thread
	if (loadContext.fragments_extra) {
		loadAsyncResource(loadContext, loadContext.fragments_extra, "", function(data) {

			if (!data || !data.length) {
				return;
			}

			//Build the R-Tree
			//var t0 = performance.now();

			var finfo = new OtgFragInfo(data, loadContext);

			if (finfo.count) {
				var tmpbvh = new BVHBuilder(null, null, finfo);
				tmpbvh.build(loadContext.bvhOptions);

				var bvh = {
					nodes: tmpbvh.nodes.getRawData(),
					primitives: tmpbvh.primitives
				};

				//var t1 = performance.now();
				//console.log("BVH build time:" + (t1 - t0));

				loadContext.worker.postMessage({bvh:bvh, boxes:finfo.boxes, boxStride:finfo.boxStride},
				                               [bvh.nodes, bvh.primitives.buffer, finfo.boxes.buffer]);
			}

		});
	}


}

export function register(workerMain) {
	workerMain.register("LOAD_OTG_BVH", { doOperation: doLoadOtgBvh });
}
