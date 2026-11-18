import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { t } from '../../i18n';
import type { CalendarEvent, Language } from '../../types';

interface Props {
  lang: Language;
  events: CalendarEvent[];
  onSaveEvents: (events: CalendarEvent[]) => void;
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function CalendarPopover({ lang, events, onSaveEvents }: Props) {
  const dict = t(lang);
  const now = new Date();
  const todayStr = toIsoDate(now.getFullYear(), now.getMonth(), now.getDate());
  const [cursor, setCursor] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [draftTitle, setDraftTitle] = useState('');

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const days = useMemo(() => {
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = Array(firstWeekday).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [year, month]);

  const monthLabel = cursor.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', {
    month: 'long',
    year: 'numeric'
  });

  const dayEvents = events.filter((e) => e.date === selectedDate);

  const addEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftTitle.trim()) return;
    onSaveEvents([
      ...events,
      { id: `ev-${Date.now()}`, date: selectedDate, title: draftTitle.trim() }
    ]);
    setDraftTitle('');
  };

  const removeEvent = (id: string) => {
    onSaveEvents(events.filter((ev) => ev.id !== id));
  };

  return (
    <div className="grid-2">
      <div className="card stack-sm">
        <div className="row-between">
          <button
            className="btn btn-icon"
            onClick={() => setCursor(new Date(year, month - 1, 1))}
          >
            <ChevronLeft size={15} />
          </button>
          <strong style={{ fontSize: 13 }}>{monthLabel}</strong>
          <button
            className="btn btn-icon"
            onClick={() => setCursor(new Date(year, month + 1, 1))}
          >
            <ChevronRight size={15} />
          </button>
        </div>

        <div className="cal-grid muted-sm" style={{ textAlign: 'center', fontSize: 11 }}>
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div key={i}>{d}</div>
          ))}
        </div>

        <div className="cal-grid">
          {days.map((day, idx) => {
            if (!day) return <div key={idx} />;
            const iso = toIsoDate(year, month, day);
            const hasEvent = events.some((ev) => ev.date === iso);
            return (
              <button
                key={iso}
                className={`cal-cell tabular ${iso === todayStr ? 'today' : ''} ${
                  iso === selectedDate ? 'selected' : ''
                }`}
                onClick={() => setSelectedDate(iso)}
              >
                {day}
                {hasEvent && <span className="cal-cell-dot" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="stack-sm">
        <span className="muted-sm tabular">
          {dict.reminders} ({selectedDate})
        </span>
        <form className="row-gap" onSubmit={addEvent}>
          <input
            className="input"
            placeholder={dict.addReminderPlaceholder}
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
          />
          <button className="btn btn-primary btn-icon" type="submit">
            <Plus size={15} />
          </button>
        </form>

        <div className="stack-sm" style={{ maxHeight: 200, overflowY: 'auto' }}>
          {dayEvents.length === 0 ? (
            <div className="card muted-sm">No reminders for {selectedDate}</div>
          ) : (
            dayEvents.map((ev) => (
              <div key={ev.id} className="card row-between" style={{ padding: '8px 10px' }}>
                <span style={{ fontSize: 13 }}>{ev.title}</span>
                <button
                  className="btn btn-icon"
                  style={{ width: 24, height: 24, borderColor: 'transparent' }}
                  onClick={() => removeEvent(ev.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
