const string = maxLength => ({ type: 'string', maxLength });
const array = (items, minItems = 0, maxItems = 15) => ({ type: 'array', items, minItems, maxItems });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const schemas = {
  facts: object({ facts: array(object({
    id: string(30), statement: string(1000), when: string(1000), who: string(1000), event: string(1000), numbers: string(1000), uncertainty: string(1000),
    evidence: array(object({ sourceId: string(30), quote: string(1200) }), 1, 5)
  }), 1, 15), unresolved: array(string(1000)) }),
  draft: object({ title: string(180), summary: string(400), paragraphs: array(object({ text: string(1500), factIds: array(string(30), 1) }), 1, 8), stances: array(string(160), 2, 2) }),
  review: object({ verdict: { type: 'string', enum: ['pass', 'needs_revision', 'uncertain'] }, summary: string(2000), issues: array(string(2000)) })
};
module.exports = { schemas };
