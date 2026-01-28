import fs from 'fs/promises';
import { PersonalityMapper } from './PersonalityMapper.js';

const data = JSON.parse(
  await fs.readFile(
    'tzurot-legacy/data/personalities/cold-kerach-batuach/cold-kerach-batuach.json',
    'utf-8'
  )
);
const mapper = new PersonalityMapper();
const testOwnerId = 'test-owner-id-for-validation';
const result = mapper.map(data, testOwnerId);
console.log('Custom Fields:', JSON.stringify(result.personality.customFields, null, 2));
