/* A bounded queue for many producers and many consumers, built up in three
 * steps.
 *
 * ch19. A ring of slots with a head and a tail. Step one is a ring for one
 * producer and one consumer, with plain increments, which the kernel lets many
 * use and watches break. Step two claims a slot by compare-and-swap on the tail
 * or the head, which stops two producers taking one slot but lets a consumer
 * claim a slot its producer has not filled. Step three gives every slot a
 * sequence number that says whose turn it is, which is the design that works.
 *
 * Each item names its producer and its number, so a consumer can check that it
 * never sees a producer's items out of order, and a bitmap says whether an item
 * arrived twice.
 */
#include "../cm.h"

#define SLOTS 1024
#define MASK (SLOTS - 1)
#define ITEMS_PER_PRODUCER 65536

struct slot {
  _Atomic uint32_t seq;
  _Atomic int value;
};

struct slot slots[SLOTS];
_Atomic uint32_t head = 0, tail = 0;

/* Which items a consumer has seen: one bit per (producer, number). */
_Atomic uint32_t seen_bits[16 * ITEMS_PER_PRODUCER / 32];

/* The checks, per consumer: items taken, items whose slot held nothing, items
   out of a producer's order, items seen twice. */
_Atomic int taken[64];
_Atomic int unwritten[64];
_Atomic int disordered[64];
_Atomic int duplicated[64];
_Atomic int dropped[64];
_Atomic int produced = 0;
_Atomic int done_producing = 0;

/* A producer that cannot enqueue after this many tries drops the item, so a
   broken design that deadlocks ends with a count instead of hanging. */
#define GIVE_UP 2000000
#define GIVE_UP_AGAIN 20000

static int encode(int producer, int number) { return 1 + producer * ITEMS_PER_PRODUCER + number; }

/* Step one: a ring for one producer and one consumer. The tail is the
   producer's alone and the head the consumer's alone, so plain loads and stores
   suffice, if they are alone. */
CM_NOINLINE int enqueue_spsc(int value) {
  uint32_t t = atomic_load_explicit(&tail, memory_order_relaxed);
  if (t - atomic_load_explicit(&head, memory_order_acquire) == SLOTS) return 0;
  atomic_store_explicit(&slots[t & MASK].value, value, memory_order_relaxed);
  atomic_store_explicit(&tail, t + 1, memory_order_release);
  return 1;
}
CM_NOINLINE int dequeue_spsc(void) {
  uint32_t h = atomic_load_explicit(&head, memory_order_relaxed);
  if (h == atomic_load_explicit(&tail, memory_order_acquire)) return -1;
  int v = atomic_exchange_explicit(&slots[h & MASK].value, 0, memory_order_relaxed);
  atomic_store_explicit(&head, h + 1, memory_order_release);
  return v;
}

/* Step two: claim a position by compare-and-swap, then use the slot. Two
   producers can no longer take one slot, but a consumer can claim a slot before
   its producer has written it. */
CM_NOINLINE int enqueue_claimed(int value) {
  uint32_t t = atomic_load_explicit(&tail, memory_order_relaxed);
  for (;;) {
    if (t - atomic_load_explicit(&head, memory_order_acquire) >= SLOTS) return 0;
    if (atomic_compare_exchange_weak_explicit(&tail, &t, t + 1, memory_order_relaxed,
                                              memory_order_relaxed)) {
      break;
    }
  }
  atomic_store_explicit(&slots[t & MASK].value, value, memory_order_release);
  return 1;
}
CM_NOINLINE int dequeue_claimed(void) {
  uint32_t h = atomic_load_explicit(&head, memory_order_relaxed);
  for (;;) {
    if (h == atomic_load_explicit(&tail, memory_order_acquire)) return -1;
    if (atomic_compare_exchange_weak_explicit(&head, &h, h + 1, memory_order_relaxed,
                                              memory_order_relaxed)) {
      break;
    }
  }
  return atomic_exchange_explicit(&slots[h & MASK].value, 0, memory_order_acquire);
}

/* Step three: every slot carries a sequence number. A slot whose sequence
   equals the position is ready for the producer at that position; one whose
   sequence is the position plus one is ready for the consumer. Claim the
   position, use the slot, then move the sequence on. */
CM_NOINLINE int enqueue(int value) {
  uint32_t t = atomic_load_explicit(&tail, memory_order_relaxed);
  for (;;) {
    struct slot *s = &slots[t & MASK];
    uint32_t seq = atomic_load_explicit(&s->seq, memory_order_acquire);
    int32_t gap = (int32_t)(seq - t);
    if (gap == 0) {
      if (atomic_compare_exchange_weak_explicit(&tail, &t, t + 1, memory_order_relaxed,
                                                memory_order_relaxed)) {
        atomic_store_explicit(&s->value, value, memory_order_relaxed);
        atomic_store_explicit(&s->seq, t + 1, memory_order_release);
        return 1;
      }
    } else if (gap < 0) {
      return 0; /* full */
    } else {
      t = atomic_load_explicit(&tail, memory_order_relaxed);
    }
  }
}
CM_NOINLINE int dequeue(void) {
  uint32_t h = atomic_load_explicit(&head, memory_order_relaxed);
  for (;;) {
    struct slot *s = &slots[h & MASK];
    uint32_t seq = atomic_load_explicit(&s->seq, memory_order_acquire);
    int32_t gap = (int32_t)(seq - (h + 1));
    if (gap == 0) {
      if (atomic_compare_exchange_weak_explicit(&head, &h, h + 1, memory_order_relaxed,
                                                memory_order_relaxed)) {
        int v = atomic_load_explicit(&s->value, memory_order_relaxed);
        atomic_store_explicit(&s->seq, h + MASK + 1, memory_order_release);
        return v;
      }
    } else if (gap < 0) {
      return -1; /* empty */
    } else {
      h = atomic_load_explicit(&head, memory_order_relaxed);
    }
  }
}

/* a: items per producer. b: the step, 0 one-to-one ring, 1 claimed positions, 2
   sequenced slots. c: producers; workers numbered below c produce, the rest
   consume. */
CM_EXPORT("cm_run") void cm_run(int tid, int a, int b, int c) {
  cm_barrier_wait();
  if (a > ITEMS_PER_PRODUCER) a = ITEMS_PER_PRODUCER;
  if (tid < c) {
    int lost = 0;
    for (int i = 0; i < a; i++) {
      int v = encode(tid & 15, i);
      int tries = 0;
      for (;;) {
        int ok = b == 0 ? enqueue_spsc(v) : b == 1 ? enqueue_claimed(v) : enqueue(v);
        if (ok) break;
        if (++tries == (lost ? GIVE_UP_AGAIN : GIVE_UP)) {
          lost++;
          break;
        }
      }
    }
    atomic_store_explicit(&dropped[tid & 63], lost, memory_order_relaxed);
    atomic_fetch_add_explicit(&produced, a - lost, memory_order_relaxed);
    atomic_fetch_add_explicit(&done_producing, 1, memory_order_release);
  } else {
    int w = tid & 63, got = 0, empty = 0, bad_order = 0, dup = 0;
    int last[16];
    for (int p = 0; p < 16; p++) last[p] = -1;
    for (;;) {
      int v = b == 0 ? dequeue_spsc() : b == 1 ? dequeue_claimed() : dequeue();
      if (v == -1) {
        if (atomic_load_explicit(&done_producing, memory_order_acquire) == c) {
          /* Everyone has finished producing: one last look, then stop. */
          v = b == 0 ? dequeue_spsc() : b == 1 ? dequeue_claimed() : dequeue();
          if (v == -1) break;
        } else {
          continue;
        }
      }
      got++;
      /* A broken design can leave head past tail, after which the ring never reads as empty and
         a consumer would walk it until the index wrapped. More items than were ever produced is
         proof enough that the design failed: stop there. */
      if (got > a * c + SLOTS) break;
      if (v == 0) {
        empty++; /* a slot that was claimed before its producer wrote it */
        continue;
      }
      int producer = (v - 1) / ITEMS_PER_PRODUCER, number = (v - 1) % ITEMS_PER_PRODUCER;
      if (producer >= 16) {
        empty++;
        continue;
      }
      if (number <= last[producer]) bad_order++;
      last[producer] = number;
      uint32_t bit = 1u << ((v - 1) & 31);
      if (atomic_fetch_or_explicit(&seen_bits[(v - 1) >> 5], bit, memory_order_relaxed) & bit)
        dup++;
    }
    atomic_store_explicit(&taken[w], got, memory_order_relaxed);
    atomic_store_explicit(&unwritten[w], empty, memory_order_relaxed);
    atomic_store_explicit(&disordered[w], bad_order, memory_order_relaxed);
    atomic_store_explicit(&duplicated[w], dup, memory_order_relaxed);
  }
}

CM_EXPORT("cm_reset") void cm_reset(void) {
  for (int i = 0; i < SLOTS; i++) {
    atomic_store_explicit(&slots[i].seq, (uint32_t)i, memory_order_relaxed);
    atomic_store_explicit(&slots[i].value, 0, memory_order_relaxed);
  }
  atomic_store_explicit(&head, 0, memory_order_relaxed);
  atomic_store_explicit(&tail, 0, memory_order_relaxed);
  for (int i = 0; i < (int)(sizeof(seen_bits) / sizeof(seen_bits[0])); i++) {
    atomic_store_explicit(&seen_bits[i], 0, memory_order_relaxed);
  }
  for (int i = 0; i < 64; i++) {
    atomic_store_explicit(&dropped[i], 0, memory_order_relaxed);
    atomic_store_explicit(&taken[i], 0, memory_order_relaxed);
    atomic_store_explicit(&unwritten[i], 0, memory_order_relaxed);
    atomic_store_explicit(&disordered[i], 0, memory_order_relaxed);
    atomic_store_explicit(&duplicated[i], 0, memory_order_relaxed);
  }
  atomic_store_explicit(&produced, 0, memory_order_relaxed);
  atomic_store_explicit(&done_producing, 0, memory_order_relaxed);
  cm_barrier_reset();
}

/* Result 0: items enqueued. Result 1: dequeues that returned something. Result
   2: dequeues of a slot its producer had not written. Result 3: items out of
   their producer's order. Result 4: items seen twice. Result 5: items a
   producer gave up on. */
CM_EXPORT("cm_result") int cm_result(int i) {
  if (i == 0) return atomic_load_explicit(&produced, memory_order_relaxed);
  if (i >= 1 && i <= 5) {
    int total = 0;
    for (int w = 0; w < 64; w++) {
      _Atomic int *arr = i == 1   ? taken
                         : i == 2 ? unwritten
                         : i == 3 ? disordered
                         : i == 4 ? duplicated
                                  : dropped;
      total += atomic_load_explicit(&arr[w], memory_order_relaxed);
    }
    return total;
  }
  return -1;
}
