import fs from 'fs/promises';
import { PersonalityMapper } from './PersonalityMapper.js';

const data = JSON.parse(await fs.readFile('tzurot-legacy/data/personalities/cold-kerach-batuach/cold-kerach-batuach.json', 'utf-8'));
const mapper = new PersonalityMapper();
const result = mapper.map(data);
console.log('Custom Fields:', JSON.stringify(result.personality.customFields, null, 2));
