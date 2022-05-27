/*!
MIT License

Copyright (c) 2019 Fyrestar

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

// Taken from https://github.com/Fyrestar/THREE.extendMaterial
// Original Author: Fyrestar https://mevedia.com (https://github.com/Fyrestar/THREE.extendMaterial)

function applyPatches(chunk, map) {
  for (let name in map) {
    const value = map[name];
    if (name[0] === '@') {
      // Replace
      const line = name.substr(1);
      chunk = chunk.replace(line, value);
    } else if (name[0] === '?') {
      // Insert before
      const line = name.substr(1);
      chunk = chunk.replace(line, value + '\n' + line);
    } else {
      // Insert after
      chunk = chunk.replace(name, name + '\n' + value);
    }
  }
  return chunk;
}

/**
 * Allows to patch shader code given a variety of access points.
 * @param {Object} shader A shader object as received in the THREE.Material.onBeforeCompile callback
 * @param {Object} object Object containing the shader code patches
 * @param {String} object.header A header snippet that is prepended to both fragment and vertex shader code
 * @param {String} object.vertexHeader A header snippet that is prepended to the vertex shader code
 * @param {String} object.fragmentHeader A header snippet that is prepended to the fragment shader code
 * @param {String} object.vertexEnd Insert code before the last closing curly bracket of the vertex shader code.
 * Does not verify that this corresponds to the main function of the shader code.
 * @param {String} object.fragmentEnd Insert code before the last closing curly bracket of the fragment shader code.
 * Does not verify that this corresponds to the main function of the shader code.
 * @param {Object} object.vertex An object specifying indicator code as the key and the value as the code that should
 * be replaced, appended or prepended in the vertex shader. The if the first char of the indicator string is '@'
 * code is replaced. If it '?' it is prepended and by default it is appended.
 * * @param {Object} object.fragment An object specifying indicator code as the key and the value as the code that should
 * be replaced, appended or prepended in the vertex shader. The if the first char of the indicator string is '@'
 * code is replaced. If it '?' it is prepended and by default it is appended.
 * @returns {Object} shader The shader object as passed in but with the patched shader code.
 */
export function patchShader(shader, object) {
  const header = (object.header || '') + '\n';
  let vertexShader = (object.vertexHeader || '') + '\n' + shader.vertexShader;
  let fragmentShader = (object.fragmentHeader || '') + '\n' + shader.fragmentShader;

  if (object.vertexEnd)
    vertexShader = vertexShader.replace(/\}(?=[^\}]*$)/g, object.vertexEnd + '\n}');

  if (object.fragmentEnd)
    fragmentShader = fragmentShader.replace(/\}(?=[^\}]*$)/g, object.fragmentEnd + '\n}');

  if (object.vertex !== undefined)
    vertexShader = applyPatches(vertexShader, object.vertex);

  if (object.fragment !== undefined)
    fragmentShader = applyPatches(fragmentShader, object.fragment);

  shader.vertexShader = header + vertexShader;
  shader.fragmentShader = header + fragmentShader;

  return shader;
}
