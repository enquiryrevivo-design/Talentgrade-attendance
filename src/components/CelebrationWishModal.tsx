import React, { useMemo, useState } from 'react';
import { Award, Cake, Send, Trash2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCelebrations } from '../context/CelebrationContext';
import { useToast } from './Toast';
import { CELEBRATION_EMOJI_OPTIONS } from '../lib/celebrationService';
import { formatCelebrationMonthDayLabel } from '../../shared/celebrationEngine';

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function CelebrationWishModal() {
  const { employee } = useAuth();
  const { showToast } = useToast();
  const {
    selectedTarget,
    closeCelebrationModal,
    wishes,
    photoUrls,
    celebrationSettings,
    todayDate,
    submitWish,
    removeWish,
  } = useCelebrations();

  const [emoji, setEmoji] = useState<string>('🎉');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const targetWishes = useMemo(() => {
    if (!selectedTarget) return [];
    return wishes.filter((w) => w.notificationId === selectedTarget.notificationId);
  }, [wishes, selectedTarget]);

  if (!selectedTarget || !employee) return null;

  const isBirthday = selectedTarget.type === 'birthday';
  const avatar = photoUrls[selectedTarget.employeeId];
  const isTodayOrPast = selectedTarget.celebrationDate <= todayDate;
  const canSendWish =
    celebrationSettings.wishesEnabled && celebrationSettings.feedEnabled && isTodayOrPast;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    try {
      await submitWish({
        target: selectedTarget,
        emoji,
        message: message.trim(),
      });
      setMessage('');
      showToast(`Celebration wish sent to ${selectedTarget.employeeName}.`, 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not send wish', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-2xl max-h-[90vh] flex flex-col">
        {/* Top Accent Strip */}
        <div className="h-1 bg-[#B5121B]" />

        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3.5 min-w-0">
            {avatar ? (
              <img
                src={avatar}
                alt={selectedTarget.employeeName}
                className="w-12 h-12 rounded-full object-cover border border-zinc-200 dark:border-zinc-700 shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-zinc-950 dark:bg-zinc-800 text-white flex items-center justify-center text-sm font-semibold shrink-0">
                {getInitials(selectedTarget.employeeName)}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#B5121B] dark:text-red-400">
                {isBirthday ? <Cake className="w-3.5 h-3.5" /> : <Award className="w-3.5 h-3.5" />}
                <span>
                  {isBirthday
                    ? 'Birthday Celebration'
                    : `Work Anniversary · ${selectedTarget.yearsCompleted || 1} ${
                        selectedTarget.yearsCompleted === 1 ? 'Year' : 'Years'
                      }`}
                </span>
              </div>
              <h3 className="text-base font-display font-semibold text-zinc-950 dark:text-zinc-100 truncate">
                {selectedTarget.employeeName}
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                {selectedTarget.department}
                {selectedTarget.designation ? ` · ${selectedTarget.designation}` : ''} ·{' '}
                {formatCelebrationMonthDayLabel(selectedTarget.celebrationMonthDay)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeCelebrationModal}
            aria-label="Close celebration modal"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Highlight Banner */}
        <div className="px-5 py-3 bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300">
          {selectedTarget.message}
        </div>

        {/* Wishes Feed */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-zinc-950 dark:text-zinc-100">
              Team Wishes ({targetWishes.length})
            </span>
            <span className="text-[11px] text-zinc-500">Privacy-safe · Birth year hidden</span>
          </div>

          {!celebrationSettings.feedEnabled ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 py-4 text-center">
              Celebration feed is currently disabled by company administration.
            </p>
          ) : targetWishes.length === 0 ? (
            <div className="p-5 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 text-center text-xs text-zinc-500 dark:text-zinc-400">
              {isTodayOrPast
                ? `Be the first to send ${isBirthday ? 'birthday' : 'anniversary'} wishes to ${selectedTarget.employeeName}!`
                : `Wishes open on ${formatCelebrationMonthDayLabel(selectedTarget.celebrationMonthDay)}.`}
            </div>
          ) : (
            <div className="space-y-2.5">
              {targetWishes.map((w) => {
                const authorAvatar = photoUrls[w.authorEmployeeId];
                const canDelete = employee.role === 'super_admin' || w.authorUid === employee.uid;
                return (
                  <div
                    key={w.id}
                    className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 flex items-start justify-between gap-3"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      {authorAvatar ? (
                        <img
                          src={authorAvatar}
                          alt={w.authorName}
                          className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 flex items-center justify-center text-[10px] font-semibold shrink-0 mt-0.5">
                          {getInitials(w.authorName)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-zinc-950 dark:text-zinc-100">
                          {w.authorName}{' '}
                          <span className="font-normal text-zinc-500 dark:text-zinc-400">
                            · {w.authorDepartment}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-700 dark:text-zinc-300 mt-1 break-words">
                          <span className="mr-1.5">{w.emoji}</span>
                          {w.message}
                        </p>
                      </div>
                    </div>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await removeWish(w);
                            showToast('Wish removed.', 'info');
                          } catch {
                            showToast('Could not remove wish.', 'error');
                          }
                        }}
                        title="Remove wish"
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-[#B5121B] hover:bg-red-50 dark:hover:bg-red-950/30 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Composer */}
        {canSendWish && (
          <form
            onSubmit={handleSend}
            className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-2.5"
          >
            <div className="flex items-center gap-1.5">
              {CELEBRATION_EMOJI_OPTIONS.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => setEmoji(em)}
                  className={`min-h-[34px] min-w-[34px] rounded-lg border text-sm transition-colors ${
                    emoji === em
                      ? 'border-[#B5121B] bg-[#B5121B]/10'
                      : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                  }`}
                >
                  {em}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                maxLength={350}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={
                  isBirthday
                    ? `Write a birthday wish for ${selectedTarget.employeeName.split(' ')[0]}...`
                    : `Congratulate ${selectedTarget.employeeName.split(' ')[0]} on their milestone...`
                }
                className="flex-1 min-h-[42px] px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs"
              />
              <button
                type="submit"
                disabled={sending || !message.trim()}
                className="min-h-[42px] px-4 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-45 shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                {sending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
