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

  const locale = lang === 'ar' ? 'ar-EG' : 'en-US';
  const monthLabel = cursor.toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric'
  });
  // 2023-01-01 was a Sunday, matching the Sunday-first grid below
  const weekdayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'narrow' });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + i)));
  }, [locale]);
  const selectedLabel = new Date(`${selectedDate}T00:00:00`).toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
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
            aria-label={lang === 'ar' ? 'الشهر السابق' : 'Previous month'}
            onClick={() => setCursor(new Date(year, month - 1, 1))}
          >
            <ChevronLeft size={15} className="flip-rtl" />
          </button>
          <strong style={{ fontSize: 13 }}>{monthLabel}</strong>
          <button
            className="btn btn-icon"
            aria-label={lang === 'ar' ? 'الشهر التالي' : 'Next month'}
            onClick={() => setCursor(new Date(year, month + 1, 1))}
          >
            <ChevronRight size={15} className="flip-rtl" />
          </button>
        </div>

        <div className="cal-grid muted-sm" style={{ textAlign: 'center', fontSize: 11 }}>
          {weekdayLabels.map((d, i) => (
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
          {dict.reminders} · {selectedLabel}
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
            <div className="card muted-sm">{dict.noReminders}</div>
          ) : (
            dayEvents.map((ev) => (
              <div key={ev.id} className="card row-between" style={{ padding: '8px 10px' }}>
                <span style={{ fontSize: 13 }} dir="auto">{ev.title}</span>
                <button
                  className="btn btn-icon"
                  style={{ width: 24, height: 24, borderColor: 'transparent' }}
                  aria-label={lang === 'ar' ? 'حذف' : 'Delete reminder'}
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
