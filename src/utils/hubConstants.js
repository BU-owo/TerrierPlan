export const HUB_LABELS = {
  PLM: "Philosophical Inquiry & Life\u2019s Meanings",
  AEX: 'Aesthetic & Interpretive Understanding',
  HCO: 'Historical Consciousness',
  SI1: 'Scientific Inquiry I',
  SI2: 'Scientific Inquiry II (w/ Lab)',
  SO1: 'Social Inquiry I',
  SO2: 'Social Inquiry II',
  QR1: 'Quantitative Reasoning I',
  QR2: 'Quantitative Reasoning II',
  IIC: 'Individual in Community',
  GCI: 'Global Citizenship & Intercultural Literacy',
  ETR: 'Ethical Reasoning',
  WIN: 'Writing-Intensive Course',
  OSC: 'Oral/Signed Communication',
  DME: 'Digital/Multimedia Expression',
  CRT: 'Critical Thinking',
  RIL: 'Research & Information Literacy',
  TWC: 'Teamwork/Collaboration',
  CRI: 'Cross-Cultural Inquiry',
};

/** How many courses must satisfy each unit */
export const HUB_REQUIRED = {
  PLM: 1, AEX: 1, HCO: 1,
  SI1: 1, SI2: 1,
  SO1: 1, SO2: 1,
  QR1: 1, QR2: 1,
  IIC: 2, GCI: 1, ETR: 1, CRI: 1,
  WIN: 2, OSC: 1,
  DME: 1, CRT: 1, RIL: 1, TWC: 1,
};

export const HUB_GROUPS = [
  {
    label: 'Philosophical, Aesthetic & Historical Interpretation',
    colorKey: 'phi',
    units: ['PLM', 'AEX', 'HCO'],
  },
  {
    label: 'Scientific & Social Inquiry',
    colorKey: 'sci',
    units: ['SI1', 'SI2', 'SO1', 'SO2'],
  },
  {
    label: 'Quantitative Reasoning',
    colorKey: 'qr',
    units: ['QR1', 'QR2'],
  },
  {
    label: 'Diversity, Civic Engagement & Global Citizenship',
    colorKey: 'div',
    units: ['IIC', 'GCI', 'ETR', 'CRI'],
  },
  {
    label: 'Communication',
    colorKey: 'com',
    units: ['WIN', 'OSC'],
  },
  {
    label: 'Intellectual Toolkit',
    colorKey: 'tl',
    units: ['DME', 'CRT', 'RIL', 'TWC'],
  },
];

/** Map from unit code → color key for CSS class suffix */
export const HUB_COLOR_FOR = Object.fromEntries(
  HUB_GROUPS.flatMap(({ colorKey, units }) =>
    units.map((u) => [u, colorKey])
  )
);

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
