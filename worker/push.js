self.addEventListener("push", (event) => {
  const alert = event.data?.json();
  if (!alert) return;
  event.waitUntil(
    self.registration.showNotification("WaterTracker balance alert", {
      body:
        "Your remaining balance is Rs. " +
        Number(alert.amount).toLocaleString("en-PK") +
        " on " +
        alert.date +
        ".",
      tag: "water-balance-" + alert.id,
      icon: "/water-192.png",
      data: "/dashboard",
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/dashboard"));
});
