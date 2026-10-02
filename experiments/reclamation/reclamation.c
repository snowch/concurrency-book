/* Memory reclamation: when may a record that readers might still be reading be
 * reused?
 *
 * ch18. A writer publishes a new record and retires the old one; readers follow
 * the pointer and read the record. Retiring at once lets a reader read a record
 * after it was reused, which the kernel makes visible by poisoning a retired
 * record. A hazard pointer, a word per reader that says which record it is
 * reading, lets the writer wait until no reader holds the old one.
 */
#include "../cm.h"

#define RECORDS 64
#define POISON (-1)

/* Each record holds one value, which is its own index plus a thousand while it
 * is live. */
_Atomic int values[RECORDS];

/* The published record: an index. Readers follow it; the writer swings it. */
_Atomic int current = 1;

/* One word per reader: the record it is about to read, or 0. */
_Atomic int hazard[64];

/* Per reader: reads made, and reads that found a poisoned record. Per writer:
 * waits. */
_Atomic int reads[64];
_Atomic int poisoned[64];
_Atomic int waits = 0;
_Atomic int updates = 0;

/* A reader with no protection: follow the pointer, read the record. */
CM_NOINLINE int read_unprotected(void) {
  int idx = atomic_load_explicit(&current, memory_order_acquire);
  return atomic_load_explicit(&values[idx], memory_order_relaxed) == 1000 + idx;
}

/* A reader with a hazard pointer: announce the record, then check the pointer
   did not move while announcing; only then read. Clear the announcement after.
 */
CM_NOINLINE int read_with_hazard(int r) {
  int idx;
  for (;;) {
    idx = atomic_load_explicit(&current, memory_order_acquire);
    atomic_store_explicit(&hazard[r], idx, memory_order_seq_cst);
    if (atomic_load_explicit(&current, memory_order_seq_cst) == idx) break;
  }
  int ok = atomic_load_explicit(&values[idx], memory_order_relaxed) == 1000 + idx;
  atomic_store_explicit(&hazard[r], 0, memory_order_release);
  return ok;
}

/* The writer: fill the next record, publish it, retire the old one. With
   hazards, retiring waits until no reader announces the old record. */
CM_NOINLINE void update(int next, int use_hazards, int readers) {
  atomic_store_explicit(&values[next], 1000 + next, memory_order_relaxed);
  int old = atomic_exchange_explicit(&current, next, memory_order_acq_rel);
  if (use_hazards) {
    for (int r = 1; r <= readers; r++) {
      while (atomic_load_explicit(&hazard[r], memory_order_seq_cst) == old) {
        atomic_fetch_add_explicit(&waits, 1, memory_order_relaxed);
      }
    }
  }
  atomic_store_explicit(&values[old], POISON, memory_order_relaxed);
}

/* Worker 0 writes; the others read. a: updates by the writer. b: 0 unprotected,
   1 hazard pointers. c: readers, so the writer knows whose hazards to check. */
CM_EXPORT("cm_run") void cm_run(int tid, int a, int b, int c) {
  cm_barrier_wait();
  if (tid == 0) {
    int next = 2;
    for (int i = 0; i < a; i++) {
      update(next, b == 1, c);
      next = next == RECORDS - 1 ? 1 : next + 1;
    }
    atomic_store_explicit(&updates, a, memory_order_relaxed);
  } else {
    int r = tid & 63, n = 0, bad = 0;
    /* Read until the writer is done, then a little longer, so every update
     * meets a reader. */
    while (atomic_load_explicit(&updates, memory_order_relaxed) == 0) {
      n++;
      if (!(b == 1 ? read_with_hazard(r) : read_unprotected())) bad++;
    }
    atomic_store_explicit(&reads[r], n, memory_order_relaxed);
    atomic_store_explicit(&poisoned[r], bad, memory_order_relaxed);
  }
}

CM_EXPORT("cm_reset") void cm_reset(void) {
  for (int i = 0; i < RECORDS; i++) atomic_store_explicit(&values[i], POISON, memory_order_relaxed);
  atomic_store_explicit(&values[1], 1001, memory_order_relaxed);
  atomic_store_explicit(&current, 1, memory_order_relaxed);
  for (int i = 0; i < 64; i++) {
    atomic_store_explicit(&hazard[i], 0, memory_order_relaxed);
    atomic_store_explicit(&reads[i], 0, memory_order_relaxed);
    atomic_store_explicit(&poisoned[i], 0, memory_order_relaxed);
  }
  atomic_store_explicit(&waits, 0, memory_order_relaxed);
  atomic_store_explicit(&updates, 0, memory_order_relaxed);
  cm_barrier_reset();
}

/* Result 0: reads, all readers. Result 1: reads of a poisoned record. Result 2:
   updates. Result 3: times the writer waited for a hazard to clear. */
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
