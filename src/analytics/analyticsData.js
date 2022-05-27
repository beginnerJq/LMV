import { endpoint } from "../file-loaders/net/endpoints";

export function getLoadModelData(url, lmvFileExtension, returnValue, node) {
    const dataToTrack = {
        url,
        lmvFileExtension,
        returnValue
    };

    if (node) {
        dataToTrack['isOtg'] = node.isOtg() && endpoint.isOtgBackend();
        dataToTrack['isSVF2'] = node.isSVF2() && endpoint.isSVF2Backend();
        dataToTrack['geometrySize'] = node.data.size || 0;
        dataToTrack['viewable_type'] = node.is2D() ? '2d' : '3d';

        // seed file info
        const viewable = node.findViewableParent();
        try {
            const name = viewable && viewable.name();
            const pos = name && name.lastIndexOf('.');
            const ext = pos >= 0 && name.substring(pos + 1);
            if (ext) {
                dataToTrack['seedFileExt'] = ext.toLowerCase();
            }
            
        // eslint-disable-next-line no-empty
        } catch(e) {
        }
    }
    
    return dataToTrack;
}
