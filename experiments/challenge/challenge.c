/* The final challenge: a booking office that sells more seats than it has.
 *
 * ch25. Workers book seats from a shared count until the office refuses. The program is wrong,
 * and the reader's job is to say why, using the whole book's model, before reading the fix. Four
 * versions: the one as written, one that makes every access atomic and is still wrong, one that
 * books by compare-and-swap, and one that books under a lock.
 */
#include "../cm.h"

/* The seats on sale, the seats left, and the bookings made. */
int capacity = 0;
int seats = 0;
_Atomic int atomic_seats = 0;
_Atomic int booked = 0;
_Atomic int lock = 0;

/* Confirming a booking takes a moment: `steps` of busy work between the check and the seat. */
static void confirm(int steps) {
  for (volatile int i = 0; i < steps; i++) {}
}

/* As written: if a seat is left, confirm the booking and take the seat. */
CM_NOINLINE int book_as_written(int steps) {
  if (seats > 0) {
    confirm(steps);
    seats--;
    return 1;
  }
  return 0;
}

/* Every access atomic: the check and the decrement are each indivisible. */
CM_NOINLINE int book_with_atomics(int steps) {
  if (atomic_load_explicit(&atomic_seats, memory_order_seq_cst) > 0) {
    confirm(steps);
    atomic_fetch_sub_explicit(&atomic_seats, 1, memory_order_seq_cst);
    return 1;
  }
  return 0;
}

/* By compare-and-swap: take the seat only if the count is still what the check saw. */
CM_NOINLINE int book_with_cas(int steps) {
  int left = atomic_load_explicit(&atomic_seats, memory_order_relaxed);
  while (left > 0) {
    confirm(steps);
    if (atomic_compare_exchange_weak_explicit(&atomic_seats, &left, left - 1, memory_order_relaxed,
                                              memory_order_relaxed)) {
      return 1;
    }
  }
  return 0;
}

/* Under a lock: the check, the confirmation and the seat, with nobody else inside. */
CM_NOINLINE int book_under_lock(int steps) {
  while (atomic_exchange_explicit(&lock, 1, memory_order_acquire) == 1) {}
  int ok = 0;
  if (seats > 0) {
    confirm(steps);
    seats--;
    ok = 1;
  }
  atomic_store_explicit(&lock, 0, memory_order_release);
  return ok;
}

/* Every worker books until the office refuses. a: the seats on sale. b: the version, 0 as
   written, 1 with atomics, 2 by compare-and-swap, 3 under a lock. c: busy steps to confirm a
   booking. */
CM_EXPORT("cm_run") void cm_run(int tid, int a, int b, int c) {
  if (tid == 0) {
    /* The first worker opens the office; the barrier publishes the capacity to the others. */
    capacity = a;
    seats = a;
    atomic_store_explicit(&atomic_seats, a, memory_order_relaxed);
  }
  cm_barrier_wait();
  int mine = 0;
  for (;;) {
    int ok = b == 1   ? book_with_atomics(c)
             : b == 2 ? book_with_cas(c)
             : b == 3 ? book_under_lock(c)
                      : book_as_written(c);
    if (!ok) break;
    mine++;
  }
  atomic_fetch_add_explicit(&booked, mine, memory_order_relaxed);
}

CM_EXPORT("cm_reset") void cm_reset(void) {
  capacity = 0;
  seats = 0;
  atomic_store_explicit(&atomic_seats, 0, memory_order_relaxed);
  atomic_store_explicit(&booked, 0, memory_order_relaxed);
  atomic_store_explicit(&lock, 0, memory_order_relaxed);
  cm_barrier_reset();
}

/* Result 0: the seats on sale. Result 1: seats booked. Result 2: seats left by the count the
   version used; below zero means the office sold seats it did not have. */
CM_EXPORT("cm_result") int cm_result(int i) {
  if (i == 0) return capacity;
  if (i == 1) return atomic_load_explicit(&booked, memory_order_relaxed);
  if (i == 2) {
    int a = atomic_load_explicit(&atomic_seats, memory_order_relaxed);
    return a != capacity ? a : seats;
  }
  return -1;
}
