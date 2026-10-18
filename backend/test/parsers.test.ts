import { test } from "node:test";
import assert from "node:assert/strict";
import { readGeoTiff } from "../src/checks/geotiff.ts";
import { epsgFromWkt, hecRasPlanRefs, readShpHeader } from "../src/checks/vector.ts";
import { WKT_UTM43N, WKT_WGS84, catchments, geotiff, hecRas, shapefile } from "../src/dev/fixtures.ts";

const reader = (buf: Buffer) => async (o: number, l: number) => buf.subarray(o, o + l);

test("GeoTIFF reader finds CRS, vertical datum, nodata and georeferencing", async () => {
  const tif = geotiff({ width: 64, height: 48, epsg: 32643, verticalEpsg: 3855, nodata: -9999, origin: [632000, 1130000], pixelSize: 2 });
  const info = await readGeoTiff(reader(tif), tif.length);
  assert.equal(info.width, 64);
  assert.equal(info.height, 48);
  assert.equal(info.bitsPerSample, 32);
  assert.equal(info.sampleFormat, "float");
  assert.equal(info.epsg, 32643);
  assert.equal(info.verticalEpsg, 3855);
  assert.equal(info.nodata, -9999);
  assert.deepEqual(info.pixelScale, [2, 2]);
  assert.deepEqual(info.origin, [632000, 1130000]);
});

test("GeoTIFF reader handles geographic CRS and missing nodata", async () => {
  const tif = geotiff({ width: 8, height: 8, epsg: 4326 });
  const info = await readGeoTiff(reader(tif), tif.length);
  assert.equal(info.epsg, 4326);
  assert.equal(info.verticalEpsg, null);
  assert.equal(info.nodata, null);
});

test("GeoTIFF reader rejects non-TIFF bytes", async () => {
  await assert.rejects(readGeoTiff(reader(Buffer.from("not a tiff at all")), 17), /Not a TIFF/);
});

test("WKT to EPSG: ESRI names, OGC authorities, geographic", () => {
  assert.equal(epsgFromWkt(WKT_UTM43N), 32643);
  assert.equal(epsgFromWkt('PROJCS["WGS 84 / UTM zone 44N",GEOGCS["WGS 84"],AUTHORITY["EPSG","32644"]]'), 32644);
  assert.equal(epsgFromWkt(WKT_WGS84), 4326);
  assert.equal(epsgFromWkt('PROJCS["Unknown local grid"]'), null);
});

test("shapefile header matches the file it describes", () => {
  const set = shapefile(catchments(5));
  const head = readShpHeader(set.shp)!;
  assert.ok(head.valid);
  assert.equal(head.declaredBytes, set.shp.length);
  assert.equal(head.shapeType, 5);
  assert.equal(readShpHeader(set.shp.subarray(0, 50)), null);
});

test("HEC-RAS plan references", () => {
  const files = hecRas();
  assert.deepEqual(hecRasPlanRefs(files["model/chalakudy.p01"].toString()), { geom: "g01", flow: "u01" });
});

test("only the AUTHORITY of the whole coordinate system counts, not the unit's or the datum's", () => {
  // ESRI-style WKT as PDAL writes it into LAS files: no code of its own, but the unit carries EPSG 9002 (foot).
  const esri =
    'PROJCS["NAD_1983_HARN_Lambert_Conformal_Conic",GEOGCS["GCS_North_American_1983_HARN",DATUM["D_North_American_1983_HARN",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["False_Easting",1312335.958],UNIT["foot",0.3048,AUTHORITY["EPSG","9002"]]]';
  assert.equal(epsgFromWkt(esri), null, "a unit's code is not the CRS");
  // The same with its own code at the top level.
  assert.equal(epsgFromWkt(esri.slice(0, -1) + ',AUTHORITY["EPSG","2992"]]'), 2992);
  // A datum or base CRS code inside is ignored when the top level has none; a name still gives a UTM zone.
  assert.equal(epsgFromWkt('PROJCS["WGS 84 / UTM zone 43N",GEOGCS["WGS 84",DATUM["WGS_1984",AUTHORITY["EPSG","6326"]],AUTHORITY["EPSG","4326"]],UNIT["metre",1,AUTHORITY["EPSG","9001"]]]'), 32643);
  // WKT2 uses ID.
  assert.equal(epsgFromWkt('PROJCRS["WGS 84 / UTM zone 43N",BASEGEOGCRS["WGS 84",ID["EPSG",4326]],ID["EPSG",32643]]'), 32643);
  // Quotes can hold brackets and the word AUTHORITY.
  assert.equal(epsgFromWkt('PROJCS["odd [AUTHORITY[\\"EPSG\\",\\"1\\"]] name",AUTHORITY["EPSG","32644"]]'), 32644);
});
