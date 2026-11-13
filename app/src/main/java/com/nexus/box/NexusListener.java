package com.nexus.box;

import android.service.notification.NotificationListenerService;

/**
 * Empty notification listener. Android only lets an app see which song is playing
 * (in Spotify etc.) and control it if the app has "notification access".
 * Nexus does not read or store any notifications.
 */
public class NexusListener extends NotificationListenerService {
}
