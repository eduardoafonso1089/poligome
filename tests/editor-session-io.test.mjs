import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf } from './helpers/source.mjs';

// A boundary is defined as much by what it refuses to re-export as by what it
// offers, and an absent import is the one thing no runtime test can observe.
const source = sourceOf('app/editor/session/editor-session-io.ts');

test('session IO uses V4 image-pixel project APIs and canonical annotations', () => {
  assert.match(source, /openPoligomeProjectV4/);
  assert.match(source, /savePoligomeProjectV4/);
  assert.match(source, /EditorAnnotation\[\]/);
  assert.doesNotMatch(source, /fromLegacyAnnotations|toLegacyAnnotations|ProjectV3/);
});

test('session IO stays a narrow project and demo boundary instead of re-exporting codec facades', () => {
  assert.match(source, /createCanonicalDemoProject/);
  assert.doesNotMatch(source, /annotationToCoco|annotationToYolo|annotationToGeoJsonGeometry|cocoAnnotationToEditor|cocoGeometryTypes/);
  assert.doesNotMatch(source, /editorAnnotationsToCoco|editorAnnotationToYolo|editorAnnotationToGeoJson|importEditorCocoAnnotation|editorCocoGeometryTypes/);
});
