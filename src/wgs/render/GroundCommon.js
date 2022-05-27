export class GroundCommon {
    needsClear(oldScenes, newScenes) {
        if (oldScenes.length !== newScenes.length)
            return true;
        for (let i = 0; i < oldScenes.length; i++) {
            if (oldScenes[i] != newScenes[i]) {
                return true;
            }
        }
        return undefined;
    }
}
