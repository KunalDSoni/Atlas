// Simple notification system for mobile app
export interface NotificationOptions {
  type?: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}

// Store for notification listeners
let listeners: Array<(notification: any) => void> = [];

export const notify = (
  message: string,
  options: NotificationOptions = {}
) => {
  const notification = {
    id: Date.now(),
    message,
    type: options.type || 'info',
    duration: options.duration || 3000,
  };

  listeners.forEach((listener) => listener(notification));

  // Auto-dismiss after duration
  if (options.duration !== Infinity) {
    setTimeout(() => {
      dismissNotification(notification.id);
    }, options.duration);
  }

  return notification.id;
};

export const dismissNotification = (id: number) => {
  listeners.forEach((listener) =>
    listener({
      id,
      dismissed: true,
    })
  );
};

export const onNotification = (listener: (notification: any) => void) => {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
};

// Shorthand methods
export const notifySuccess = (message: string, duration?: number) =>
  notify(message, { type: 'success', duration });

export const notifyError = (message: string, duration?: number) =>
  notify(message, { type: 'error', duration });

export const notifyInfo = (message: string, duration?: number) =>
  notify(message, { type: 'info', duration });

export const notifyWarning = (message: string, duration?: number) =>
  notify(message, { type: 'warning', duration });
