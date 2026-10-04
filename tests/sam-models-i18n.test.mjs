import test from 'node:test';
import assert from 'node:assert/strict';
import { SAM_MODELS } from '../app/lib/sam-models.ts';
import { TRANSLATED_SAM_TEXTS, localizeSamModel, translateSamText } from '../app/lib/sam-models-i18n.ts';

/** Every text the SAM card shows, as the catalog writes it. */
function shownTexts(model) {
  const texts = [model.name, model.description, model.license.name, model.license.notes, model.checkpoint.notes,
    model.benchmark.hardware, model.benchmark.software, ...model.benchmark.notes];
  for (const requirement of Object.values(model.requirements)) texts.push(requirement.notes, requirement.official, requirement.tested);
  for (const platform of Object.values(model.platformSupport)) texts.push(platform.notes);
  for (const future of model.futureCapabilities) texts.push(future.name, future.description, future.benchmark.hardware, future.benchmark.speedupAt128Objects);
  // Prose only: ids, version numbers and sizes have no words to translate.
  return texts.filter((text) => typeof text === 'string' && /[a-zà-ú]{3,}\s/i.test(text));
}

test('every text shown on a SAM card has an en, fr and es translation', () => {
  const missing = [...new Set(SAM_MODELS.flatMap(shownTexts))].filter((text) => !TRANSLATED_SAM_TEXTS.has(text));
  assert.deepEqual(missing, [], 'add these catalog texts to app/lib/sam-models-i18n.ts');
});

test('localizing changes prose and leaves ids, urls and numbers alone', () => {
  const model = SAM_MODELS.find((candidate) => candidate.id === 'medsam2-ct-lesion');
  const english = localizeSamModel(model, 'en');
  assert.equal(english.id, model.id);
  assert.equal(english.checkpoint.downloadUrl, model.checkpoint.downloadUrl);
  assert.equal(english.parameters.label, model.parameters.label);
  assert.equal(english.name, 'MedSAM2 · CT lesion');
  assert.notEqual(english.description, model.description);
  assert.equal(localizeSamModel(model, 'pt'), model, 'Portuguese is the source and comes back untouched');
  assert.equal(translateSamText('not in the table', 'fr'), 'not in the table');
});
