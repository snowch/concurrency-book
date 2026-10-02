/* Read-copy-update: readers never wait; the writer waits for them instead.
 *
 * ch20. Readers follow a pointer to a record and read it, with no atomic
 * read-modify-write and no announcement of which record they hold: only a note,
 * outside their read, of the epoch they last saw. The writer copies, updates,
 * publishes the new record, moves the epoch on, and waits until every reader
 * has noted the new epoch, which means every read that began before the publish
 * has finished. Only then is the old record reused. That wait is the grace
 * period.
 */
#include "../cm.h"

#define RECORDS 64
#define POISON (-1)

_Atomic int values[RECORDS];
_Atomic int current = 1;

/* The epoch: moved on by the writer after each publish. Each reader notes the
   epoch it has seen between reads, which is its quiescent state. */
_Atomic int epoch = 0;
_Atomic int seen[64];

_Atomic int reads[64];
_Atomic int poisoned[64];
_Atomic int waits = 0;
_Atomic int updates = 0;

/* The read side: follow the pointer, read the record. Nothing else. */
CM_NOINLINE int rcu_read(void) {
  int idx = atomic_load_explicit(&current, memory_order_acquire);
  return atomic_load_explicit(&values[idx], memory_order_relaxed) == 1000 + idx;
}

/* Between reads: note the epoch. A reader that has noted epoch e cannot be
   inside a read that began before the writer moved the epoch to e. */
CM_NOINLINE void rcu_quiescent(int r) {
  atomic_store_explicit(&seen[r], atomic_load_explicit(&epoch, memory_order_seq_cst),
                        memory_order_seq_cst);
}

/* The write side: publish, then wait for the grace period, then reuse. */
CM_NOINLINE void rcu_update(int next, int wait_for_readers, int readers) {
  atomic_store_explicit(&values[next], 1000 + next, memory_order_relaxed);
  int old = atomic_exchange_explicit(&current, next, memory_order_acq_rel);
  if (wait_for_readers) {
    int e = atomic_fetch_add_explicit(&epoch, 1, memory_order_seq_cst) + 1;
    for (int r = 1; r <= readers; r++) {
      while (atomic_load_explicit(&seen[r], memory_order_seq_cst) < e) {
        atomic_fetch_add_explicit(&waits, 1, memory_order_relaxed);
      }
    }
  }
  atomic_store_explicit(&values[old], POISON, memory_order_relaxed);
}

/* Worker 0 writes; the others read. a: updates. b: 0 reuse at once, 1 wait for
   the grace period. c: readers. */
CM_EXPORT("cm_run") void cm_run(int tid, int a, int b, int c) {
  cm_barrier_wait();
  if (tid == 0) {
    int next = 2;
    for (int i = 0; i < a; i++) {
      rcu_update(next, b == 1, c);
      next = next == RECORDS - 1 ? 1 : next + 1;
    }
    atomic_store_explicit(&updates, a, memory_order_relaxed);
  } else {
    int r = tid & 63, n = 0, bad = 0;
    while (atomic_load_explicit(&updates, memory_order_relaxed) == 0) {
      rcu_quiescent(r);
      n++;
      if (!rcu_read()) bad++;
    }
    rcu_quiescent(r);
    atomic_store_explicit(&reads[r], n, memory_order_relaxed);
    atomic_store_explicit(&poisoned[r], bad, memory_order_relaxed);
  }
}

CM_EXPORT("cm_reset") void cm_reset(void) {
  for (int i = 0; i < RECORDS; i++) atomic_store_explicit(&values[i], POISON, memory_order_relaxed);
  atomic_store_explicit(&values[1], 1001, memory_order_relaxed);
  atomic_store_explicit(&current, 1, memory_order_relaxed);
  atomic_store_explicit(&epoch, 0, memory_order_relaxed);
  for (int i = 0; i < 64; i++) {
    atomic_store_explicit(&seen[i], 0, memory_order_relaxed);
    atomic_store_explicit(&reads[i], 0, memory_order_relaxed);
    atomic_store_explicit(&poisoned[i], 0, memory_order_relaxed);
  }
  atomic_store_explicit(&waits, 0, memory_order_relaxed);
  atomic_store_explicit(&updates, 0, memory_order_relaxed);
  cm_barrier_reset();
}

/* Result 0: reads. Result 1: poisoned reads. Result 2: updates. Result 3:
 * grace-period waits. */
CM_EXPORT("cm_result") int cm_result(int i) {
  if (i == 0 || i == 1) {
    int total = 0;
    for (int r = 0; r < 64; r++) {
      total += atomic_load_explicit(i == 0 ? &reads[r] : &poisoned[r], memory_order_relaxed);
    }
    return total;
  }
  if (i == 2) return atomic_load_explicit(&updates, memory_order_relaxed);
  if (i == 3) return atomic_load_explicit(&waits, memory_order_relaxed);
  return -1;
}
