/* TalentGrade Workforce Portal — Service Worker Web Push & Deep-Link Handler */

self.addEventListener('push', (event) => {
  let payload = {
    title: 'TalentGrade · Attendance Reminder',
    body: 'Please review your attendance punch-in or punch-out status in the TalentGrade Workforce Portal.',
    url: '/?page=attendance&action=punch',
    tag: 'talentgrade_attendance_reminder',
    reminderType: 'punch_in',
    attendanceDate: '',
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        payload = {
          ...payload,
          ...parsed,
        };
      }
    } catch {
      const txt = event.data.text();
      if (txt) {
        payload.body = txt;
      }
    }
  }

  const options = {
    body: payload.body,
    icon: '/pwa-192x192.png',
    badge: '/badge-72x72.png',
    tag: payload.tag || 'talentgrade_attendance_reminder',
    renotify: true,
    requireInteraction: true,
    data: {
      url: payload.url || '/?page=attendance&action=punch',
      reminderType: payload.reminderType || 'punch_in',
      attendanceDate: payload.attendanceDate || '',
    },
    actions: [
      {
        action: 'open_attendance',
        title: 'Open Attendance',
      },
    ],
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetPath =
    (event.notification &&
      event.notification.data &&
      event.notification.data.url) ||
    '/?page=attendance&action=punch';

  const reminderType =
    (event.notification &&
      event.notification.data &&
      event.notification.data.reminderType) ||
    'punch_in';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        const origin = self.location.origin;
        for (const client of clientList) {
          if (client.url && client.url.startsWith(origin) && 'focus' in client) {
            client.postMessage({
              type: 'NAVIGATE_ATTENDANCE',
              url: targetPath,
              reminderType,
            });
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetPath);
        }
        return undefined;
      })
  );
});
