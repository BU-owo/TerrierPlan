/** 
 * HUB Labels (full descriptive names)
 */
export const HUB_LABELS = {
  // Philosophical, Aesthetic, Historical
  PLM: "Philosophical Inquiry & Life's Meanings",
  AEX: 'Aesthetic Exploration',
  HCO: 'Historical Consciousness',
  // Scientific & Social Inquiry
  SI1: 'Scientific Inquiry I',
  SI2: 'Scientific Inquiry II',
  SO1: 'Social Inquiry I',
  SO2: 'Social Inquiry II',
  // Quantitative Reasoning
  QR1: 'Quantitative Reasoning I',
  QR2: 'Quantitative Reasoning II',
  // Diversity, Civic, Global
  IIC: 'The Individual in Community',
  GCI: 'Global Citizenship & Intercultural Literacy',
  ETR: 'Ethical Reasoning',
  // Communication
  FYW: 'First-Year Writing Seminar',
  WRI: 'Writing, Research, and Inquiry',
  WIN: 'Writing-Intensive Course',
  OSC: 'Oral and/or Signed Communication',
  DME: 'Digital/Multimedia Expression',
  // Intellectual Toolkit
  CRT: 'Critical Thinking',
  RIL: 'Research and Information Literacy',
  TWC: 'Teamwork/Collaboration',
  CRI: 'Creativity/Innovation',
};

/**
 * 6-group color palette
 * Each group has: label, colorHex, and all units in that group
 */
export const HUB_GROUPS = [
  {
    id: 'philosophical',
    label: 'Philosophical, Aesthetic, Historical',
    colorHex: '#B0413E', // deep rose
    units: ['PLM', 'AEX', 'HCO'],
  },
  {
    id: 'scientific',
    label: 'Scientific and Social Inquiry',
    colorHex: '#2F6F5E', // forest green
    units: ['SI1', 'SI2', 'SO1', 'SO2'],
  },
  {
    id: 'quantitative',
    label: 'Quantitative Reasoning',
    colorHex: '#3B5D8C', // slate blue
    units: ['QR1', 'QR2'],
  },
  {
    id: 'diversity',
    label: 'Diversity, Civic, Global',
    colorHex: '#C77B2E', // amber
    units: ['IIC', 'GCI', 'ETR'],
  },
  {
    id: 'communication',
    label: 'Communication',
    colorHex: '#7A4F9E', // plum
    units: ['FYW', 'WRI', 'WIN', 'OSC', 'DME'],
  },
  {
    id: 'toolkit',
    label: 'Intellectual Toolkit',
    colorHex: '#4A7A8C', // teal
    units: ['CRT', 'RIL', 'TWC', 'CRI'],
  },
];

/** Map from unit code → group info (label, color, id) */
export const HUB_COLOR_FOR = Object.fromEntries(
  HUB_GROUPS.flatMap(({ id, colorHex, units }) =>
    units.map((u) => [u, { groupId: id, color: colorHex }])
  )
);

/**
 * FIRST-YEAR STUDENT REQUIREMENTS
 * 
 * Structure: array of requirement objects
 * Each requirement is either:
 *   - { id, groupLabel, units: [code], required: count } (simple)
 *   - { id, groupLabel, unitOptions: [[codes1], [codes2]...], required: count } (OR-group)
 */
export const FIRST_YEAR_REQUIREMENTS = [
  // Philosophical, Aesthetic, Historical (3 required individually)
  { id: 'fy-plm', groupLabel: 'Philosophical, Aesthetic, Historical', units: ['PLM'], required: 1 },
  { id: 'fy-aex', groupLabel: 'Philosophical, Aesthetic, Historical', units: ['AEX'], required: 1 },
  { id: 'fy-hco', groupLabel: 'Philosophical, Aesthetic, Historical', units: ['HCO'], required: 1 },
  
  // Scientific & Social Inquiry (3 required: SI1, SO1, and one of SI2/SO2)
  { id: 'fy-si1', groupLabel: 'Scientific and Social Inquiry', units: ['SI1'], required: 1 },
  { id: 'fy-so1', groupLabel: 'Scientific and Social Inquiry', units: ['SO1'], required: 1 },
  { id: 'fy-si2-so2', groupLabel: 'Scientific and Social Inquiry', unitOptions: [['SI2'], ['SO2']], required: 1 },
  
  // Quantitative Reasoning (2 required individually)
  { id: 'fy-qr1', groupLabel: 'Quantitative Reasoning', units: ['QR1'], required: 1 },
  { id: 'fy-qr2', groupLabel: 'Quantitative Reasoning', units: ['QR2'], required: 1 },
  
  // Diversity, Civic, Global (4 required: IIC, 2x GCI, ETR)
  { id: 'fy-iic', groupLabel: 'Diversity, Civic, Global', units: ['IIC'], required: 1 },
  { id: 'fy-gci-2', groupLabel: 'Diversity, Civic, Global', units: ['GCI'], required: 2 },
  { id: 'fy-etr', groupLabel: 'Diversity, Civic, Global', units: ['ETR'], required: 1 },
  
  // Communication (6 required: FYW, WRI, 2x WIN, OSC, DME)
  { id: 'fy-fyw', groupLabel: 'Communication', units: ['FYW'], required: 1 },
  { id: 'fy-wri', groupLabel: 'Communication', units: ['WRI'], required: 1 },
  { id: 'fy-win-2', groupLabel: 'Communication', units: ['WIN'], required: 2 },
  { id: 'fy-osc', groupLabel: 'Communication', units: ['OSC'], required: 1 },
  { id: 'fy-dme', groupLabel: 'Communication', units: ['DME'], required: 1 },
  
  // Intellectual Toolkit (8 required: 2x CRT, 2x RIL, 2x TWC, 2x CRI)
  { id: 'fy-crt-2', groupLabel: 'Intellectual Toolkit', units: ['CRT'], required: 2 },
  { id: 'fy-ril-2', groupLabel: 'Intellectual Toolkit', units: ['RIL'], required: 2 },
  { id: 'fy-twc-2', groupLabel: 'Intellectual Toolkit', units: ['TWC'], required: 2 },
  { id: 'fy-cri-2', groupLabel: 'Intellectual Toolkit', units: ['CRI'], required: 2 },
];

/**
 * TRANSFER STUDENT REQUIREMENTS
 * 
 * 10 requirements with more flexible OR-grouping
 */
export const TRANSFER_REQUIREMENTS = [
  // 1: PLM OR AEX OR HCO
  { id: 'tr-pah', groupLabel: 'Philosophical, Aesthetic, Historical', unitOptions: [['PLM'], ['AEX'], ['HCO']], required: 1 },
  
  // 2: SI1 OR SI2
  { id: 'tr-si', groupLabel: 'Scientific and Social Inquiry', unitOptions: [['SI1'], ['SI2']], required: 1 },
  
  // 3: SO1 OR SO2
  { id: 'tr-so', groupLabel: 'Scientific and Social Inquiry', unitOptions: [['SO1'], ['SO2']], required: 1 },
  
  // 4: QR2
  { id: 'tr-qr2', groupLabel: 'Quantitative Reasoning', units: ['QR2'], required: 1 },
  
  // 5: IIC OR GCI OR ETR
  { id: 'tr-icg', groupLabel: 'Diversity, Civic, Global', unitOptions: [['IIC'], ['GCI'], ['ETR']], required: 1 },
  
  // 6: WRI OR WIN
  { id: 'tr-ww', groupLabel: 'Communication', unitOptions: [['WRI'], ['WIN']], required: 1 },
  
  // 7-10: Individual Intellectual Toolkit items
  { id: 'tr-crt', groupLabel: 'Intellectual Toolkit', units: ['CRT'], required: 1 },
  { id: 'tr-ril', groupLabel: 'Intellectual Toolkit', units: ['RIL'], required: 1 },
  { id: 'tr-twc', groupLabel: 'Intellectual Toolkit', units: ['TWC'], required: 1 },
  { id: 'tr-cri', groupLabel: 'Intellectual Toolkit', units: ['CRI'], required: 1 },
];

/**
 * Display names for OR-groups in the UI
 */
export const OR_GROUP_DISPLAY_NAMES = {
  'si2-so2': 'Scientific Inquiry II or Social Inquiry II',
  'pah': 'Philosophical, Aesthetic, or Historical Inquiry',
  'si': 'Scientific Inquiry I or II',
  'so': 'Social Inquiry I or II',
  'icg': 'Individual, Civic, or Global',
  'ww': 'Writing (Research) or Writing-Intensive',
};

/**
 * Compute which requirements are satisfied given a count map { unitCode: count }
 * @param {Object} counts - { unitCode: number satisfied }
 * @param {Array} requirements - array of requirement objects
 * @returns {Array} array of { requirement, isSatisfied: boolean }
 */
export function computeProgress(counts, requirements) {
  return requirements.map((req) => {
    let isSatisfied = false;
    
    if (req.units) {
      // Simple requirement: check if all units in this requirement have enough
      const totalSatisfied = req.units.reduce((sum, code) => sum + (counts[code] ?? 0), 0);
      isSatisfied = totalSatisfied >= req.required;
    } else if (req.unitOptions) {
      // OR-group: count total from ANY of the option groups
      const totalSatisfied = req.unitOptions.reduce((sum, optGroup) => {
        const optSum = optGroup.reduce((s, code) => s + (counts[code] ?? 0), 0);
        return sum + optSum;
      }, 0);
      isSatisfied = totalSatisfied >= req.required;
    }
    
    return { requirement: req, isSatisfied };
  });
}

/**
 * Semester labels for the year-based layout (8 semesters = 4 academic years)
 */
export const SEMESTER_LABELS = [
  'Year 1 – Fall',
  'Year 1 – Spring',
  'Year 2 – Fall',
  'Year 2 – Spring',
  'Year 3 – Fall',
  'Year 3 – Spring',
  'Year 4 – Fall',
  'Year 4 – Spring',
];
