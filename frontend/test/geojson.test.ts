import { test } from "node:test";
import assert from "node:assert/strict";
import { geojsonFeatures } from "../lib/geojson.ts";

test("a FeatureCollection becomes features with flattened coordinates and a row of properties each", () => {
  const data = geojsonFeatures(
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { name: "Gauge", stage: 3.4, nested: { a: 1 } }, geometry: { type: "Point", coordinates: [76.3, 10.3] } },
        { type: "Feature", properties: { name: "Reach" }, geometry: { type: "LineString", coordinates: [[76.2, 10.2], [76.3, 10.3]] } },
        { type: "Feature", properties: null, geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]], [[0.5, 0.2], [1, 0.2], [1, 0.5], [0.5, 0.2]]] } },
        { type: "Feature", properties: {}, geometry: null },
      ],
    }),
  );
  assert.ok(data);
  assert.equal(data.count, 3, "a feature with no geometry is not counted");
  assert.deepEqual(data.features.map((f) => f.kind), ["point", "line", "polygon"]);
  assert.deepEqual(data.features[0].parts, [[76.3, 10.3]]);
  assert.deepEqual(data.features[1].parts, [[76.2, 10.2, 76.3, 10.3]]);
  assert.equal(data.features[2].parts.length, 2, "a ring and its hole");
  assert.deepEqual(data.fields.map((f) => f.name), ["name", "stage", "nested"]);
  assert.deepEqual(data.features[0].props, { name: "Gauge", stage: 3.4, nested: '{"a":1}' });
  assert.deepEqual(data.bbox, [0, 0, 76.3, 10.3]);
});

test("a bare geometry, a multi-polygon and a collection are drawn too; other JSON is not GeoJSON", () => {
  assert.equal(geojsonFeatures('{"type":"Point","coordinates":[1,2]}')?.count, 1);
  const multi = geojsonFeatures('{"type":"MultiPolygon","coordinates":[[[[0,0],[1,0],[1,1],[0,0]]],[[[5,5],[6,5],[6,6],[5,5]]]]}');
  assert.equal(multi?.features[0].parts.length, 2);
  const collection = geojsonFeatures('{"type":"GeometryCollection","geometries":[{"type":"Point","coordinates":[1,2]},{"type":"LineString","coordinates":[[0,0],[1,1]]}]}');
  assert.equal(collection?.features[0].kind, "line");
  assert.equal(geojsonFeatures('{"name":"not geojson"}'), null);
  assert.equal(geojsonFeatures("[1,2,3]"), null);
  assert.equal(geojsonFeatures("not json"), null);
});
