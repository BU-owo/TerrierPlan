// Dev-only fixture: with `?mockMeetings=1` in the URL (and only in `npm run
// dev` — import.meta.env.DEV is false in a production build, so this does
// nothing there), two real sections get a `meetings` array after they load,
// so the multi-meeting UI can be tried before that data is in Firestore:
//   QST SM 131 GA — Tue Thu 8:00–9:15am + Fri 8:00–8:50am
//   CAS CH 102 A1 — its normal class time + a Tue 6:30–8:30pm exam (NO ROOM)
// Sections that already have `meetings` are left alone.
function mockEnabled() {
  return import.meta.env.DEV
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('mockMeetings') === '1';
}

export function withMockMeetings(section) {
  if (!mockEnabled() || Array.isArray(section.meetings)) return section;
  const dates = { meetingStartDate: section.meetingStartDate || '', meetingEndDate: section.meetingEndDate || '' };
  if (section.subjectArea === 'QSTSM' && section.catalogNbr === '131' && section.classSection === 'GA') {
    return {
      ...section,
      meetings: [
        { daysOfWeek: 'Tue Thu', startTime: '08:00AM', endTime: '09:15AM', facilId: section.facilId || '', ...dates, kind: 'class' },
        { daysOfWeek: 'Fri', startTime: '08:00AM', endTime: '08:50AM', facilId: section.facilId || '', ...dates, kind: 'class' },
      ],
    };
  }
  if (section.subjectArea === 'CASCH' && section.catalogNbr === '102' && section.classSection === 'A1') {
    return {
      ...section,
      meetings: [
        {
          daysOfWeek: section.daysOfWeek || '', startTime: section.startTime || '', endTime: section.endTime || '',
          facilId: section.facilId || '', ...dates, kind: 'class',
        },
        { daysOfWeek: 'Tue', startTime: '06:30PM', endTime: '08:30PM', facilId: 'NO ROOM', ...dates, kind: 'exam' },
      ],
    };
  }
  return section;
}
