import { useState, useEffect } from 'react';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';

export default function BulletinPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [majorList, setMajorList] = useState([]); // [{ slug, majorName }]
  const [selectedSlug, setSelectedSlug] = useState('');
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [listLoaded, setListLoaded] = useState(false);

  // Load major list lazily when panel first opens
  useEffect(() => {
    if (!isOpen || listLoaded) return;
    (async () => {
      const snap = await getDocs(collection(db, 'bulletinPages'));
      const list = snap.docs.map((d) => ({
        slug: d.id,
        majorName: d.data().majorName ?? d.id,
      }));
      list.sort((a, b) => a.majorName.localeCompare(b.majorName));
      setMajorList(list);
      setListLoaded(true);
    })();
  }, [isOpen, listLoaded]);

  // Fetch content when a major is selected
  useEffect(() => {
    if (!selectedSlug) {
      setContent(null);
      return;
    }
    setLoading(true);
    getDoc(doc(db, 'bulletinPages', selectedSlug))
      .then((snap) => {
        if (snap.exists()) setContent(snap.data().content ?? '');
        else setContent('');
      })
      .finally(() => setLoading(false));
  }, [selectedSlug]);

  return (
    <div className="bulletin-panel">
      {/* Toggle bar */}
      <div
        className="bulletin-toggle-bar"
        onClick={() => setIsOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setIsOpen((o) => !o)}
        aria-expanded={isOpen}
      >
        <div className="bulletin-toggle-left">
          <span>📋</span>
          <span>Major Requirements Bulletin</span>
          {selectedSlug && majorList.length > 0 && (
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11 }}>
              —&nbsp;
              {majorList.find((m) => m.slug === selectedSlug)?.majorName ?? selectedSlug}
            </span>
          )}
        </div>
        <span className={`bulletin-toggle-arrow${isOpen ? ' open' : ''}`}>▼</span>
      </div>

      {/* Collapsible body */}
      <div className={`bulletin-body${isOpen ? ' open' : ''}`}>
        <div className="bulletin-body-inner">
          <div className="bulletin-content-area">
            {/* Major selector */}
            <div className="bulletin-major-selector">
              <label htmlFor="bulletin-major">Major</label>
              {majorList.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  No bulletin pages loaded yet.{' '}
                  <span style={{ display: 'block', marginTop: 4 }}>
                    Pages can be added by running the bulletin import script.
                  </span>
                </p>
              ) : (
                <select
                  id="bulletin-major"
                  className="bulletin-major-select"
                  value={selectedSlug}
                  onChange={(e) => setSelectedSlug(e.target.value)}
                >
                  <option value="">— Pick a major —</option>
                  {majorList.map((m) => (
                    <option key={m.slug} value={m.slug}>
                      {m.majorName}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Content pane */}
            {majorList.length > 0 && (
              loading ? (
                <div className="bulletin-empty">Loading…</div>
              ) : !selectedSlug ? (
                <div className="bulletin-empty">
                  Select a major to view its requirements.
                </div>
              ) : content === '' ? (
                <div className="bulletin-empty">No content stored for this major.</div>
              ) : (
                <div
                  className="bulletin-text"
                  dangerouslySetInnerHTML={{ __html: content }}
                />
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
