
import { isMobileDevice } from "../compat";

// If true, will use a different code path where data structures are
// optimized for using less memory.
export let memoryOptimizedLoading = true;
export let GPU_MEMORY_LIMIT = (isMobileDevice() ? 64 : 256) * 1024 * 1024;
export let GPU_OBJECT_LIMIT = isMobileDevice() ? 2500 : 10000;

//VAO objects do have quite a bit of memory overhead, so use of VAO can be optionally
//turned off
export let USE_VAO = !isMobileDevice();

// Overhead for geometry buffer. 112 bytes by the BufferGeometry object, 112 bytes for
// each of the index and vertex buffer arrays. The buffer used by the index and vertex
// buffer arrays is shared by multiple geometry objects, so we don't include the 64
// byte overhead for that.
//TODO: TS Check with Cleve how the 112 for the index and vertex arrays is calculated. The 112 for BufferGeometry
//comes from the memory profiler which shows 104 for those.
export const GEOMETRY_OVERHEAD = 336;

// This is the threshold of the projected screen pixel for culling.
export const PIXEL_CULLING_THRESHOLD = 1;
