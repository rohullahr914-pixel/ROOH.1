# Neural laboratory reference notes

The ROOH neural laboratory is original Three.js and React Three Fiber code. It adapts technical and visual ideas from the four downloaded references without importing their applications, renderers, camera handlers, or MediaPipe trackers.

- **Neural Cloud / graph-node-master**: seeded graph generation, spatial hashing, BFS activation distances, and coherent point/edge shader motion informed the spherical graph. Its README states MIT, but the downloaded copy contains no LICENSE file; obtain the upstream license text before copying source verbatim.
- **Interactive Neural Network Viz**: electrical pulses and interactive activation informed the shader behavior. The downloaded LICENSE.txt is MIT, copyright 2026 Redemple Marcelo, and credits the original CodePen by VoXelo.
- **Interactive Three.js Particle Morph**: formation changes and swarm motion informed the GPU morph uniform. The downloaded LICENSE.txt is MIT, copyright 2026 Sandra Márquez, and credits the original CodePen by VoXelo.
- **Creative Vision Neural Memory Network**: semantic regions and gesture navigation informed the original region selector. The downloaded copy has no license notice, so no source was copied.

Source locations: visual-references/ contains all four projects and their original notices. Retain the MIT license texts there and include the relevant copyright notice if source is later copied into ROOH.

The scene uses the existing ROOH client-only canvas, model loader, OpenAI Realtime state, shared camera manager, and MediaPipe gesture recognizer. Low, Balanced, and High profiles adjust geometry and pixel ratio; sustained slow frame times reduce the selected profile.
