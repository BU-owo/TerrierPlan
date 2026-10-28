import { wrTopics } from '../data/wrTopics.js';

// { title, description } for a WR section, or null. Only for the term the data was built
// for, so it quietly does nothing once CURRENT_TERM moves on.
export function getWrTopic(section) {
  if (!section || String(section.term) !== wrTopics.term) return null;
  const key = wrTopics.sections[String(section.classNbr)];
  return (key && wrTopics.topics[key]) || null;
}
