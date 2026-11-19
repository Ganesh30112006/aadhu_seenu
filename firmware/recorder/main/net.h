/*
 * net_task: Wi-Fi (auto-reconnect), WSS client, `hello` handshake, live-first sending of
 * un-ACKed chunks, selective-ACK processing, exponential backoff with jitter (contracts §1).
 */
#pragma once

void net_start(void);
