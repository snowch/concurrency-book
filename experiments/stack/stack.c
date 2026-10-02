/* A lock-free stack: push and pop by compare-and-swap on the head, with no
 * lock.
 *
 * ch16 builds it. Nodes live in a pool and are named by index, so that an index
 * is what the head holds and what compare-and-swap compares; zero means "no
 * node". Each worker owns a range of nodes, pushes them all, then pops as many
 * as it can, from anyone. Every node remembers how often it was popped, so the
 * page can count the two ways a stack can go wrong: a node popped twice, and a
 * node that is in nobody's hands and not in the stack.
 */
#include "../cm.h"

#define NODES 65536
#define PER_WORKER 4095

struct node {
  _Atomic int next; /* the index of the node below this one, or 0 */
  _Atomic int pops; /* how many times this node was popped */
};

struct node nodes[NODES];

/* The top of the stack: a node index, or 0 when the stack is empty. */
_Atomic int head = 0;

/* Per worker: how many pops found the stack empty. */
_Atomic int empties[64];
_Atomic int popped[64];

/* Push node n: point it at the current top, then swing the head to it, if the
   top is still what we pointed at; otherwise point again. */
CM_NOINLINE void push(int n) {
  int top = atomic_load_explicit(&head, memory_order_relaxed);
  do {
    atomic_store_explicit(&nodes[n].next, top, memory_order_relaxed);
  } while (!atomic_compare_exchange_weak_explicit(&head, &top, n, memory_order_release,
                                                  memory_order_relaxed));
}

/* Pop: read the top and the node below it, then swing the head to the node
   below, if the top is still the one we read; otherwise read again. Returns the
   node, or 0 if the stack was empty. */
CM_NOINLINE int pop(void) {
  int top = atomic_load_explicit(&head, memory_order_acquire);
  while (top != 0) {
    int below = atomic_load_explicit(&nodes[top].next, memory_order_relaxed);
    if (atomic_compare_exchange_weak_explicit(&head, &top, below, memory_order_acquire,
                                              memory_order_acquire)) {
      return top;
    }
  }
  return 0;
}

/* Not a pop: read the top, then store the node below it as the head, in two
 * steps. */
CM_NOINLINE int pop_broken(void) {
  int top = atomic_load_explicit(&head, memory_order_acquire);
  if (top == 0) return 0;
  int below = atomic_load_explicit(&nodes[top].next, memory_order_relaxed);
  atomic_store_explicit(&head, below, memory_order_release);
  return top;
}

/* a: nodes per worker to push, then pop (at most PER_WORKER). b: 0 the
   compare-and-swap pop, 1 the broken one. c: unused. */
CM_EXPORT("cm_run") void cm_run(int tid, int a, int b, int c) {
  (void)c;
  int w = tid & 15;
  if (a > PER_WORKER) a = PER_WORKER;
  cm_barrier_wait();
  for (int i = 0; i < a; i++) push(1 + w * PER_WORKER + i);
  int got = 0, empty = 0;
  for (int i = 0; i < a; i++) {
    int n = b == 1 ? pop_broken() : pop();
    if (n == 0) {
      empty++;
    } else {
      got++;
      atomic_fetch_add_explicit(&nodes[n].pops, 1, memory_order_relaxed);
    }
  }
  atomic_store_explicit(&popped[tid & 63], got, memory_order_relaxed);
  atomic_store_explicit(&empties[tid & 63], empty, memory_order_relaxed);
}

CM_EXPORT("cm_reset") void cm_reset(void) {
  atomic_store_explicit(&head, 0, memory_order_relaxed);
  for (int i = 0; i < NODES; i++) {
    atomic_store_explicit(&nodes[i].next, 0, memory_order_relaxed);
    atomic_store_explicit(&nodes[i].pops, 0, memory_order_relaxed);
  }
  for (int i = 0; i < 64; i++) {
    atomic_store_explicit(&popped[i], 0, memory_order_relaxed);
    atomic_store_explicit(&empties[i], 0, memory_order_relaxed);
  }
  cm_barrier_reset();
}

/* Result 0: nodes popped, all workers. Result 1: nodes still in the stack.
   Result 2: nodes popped more than once. Result 3: nodes popped exactly once.
   Result 4: pops that found the stack empty. */
CM_EXPORT("cm_result") int cm_result(int i) {
  if (i == 0 || i == 4) {
    int total = 0;
    for (int w = 0; w < 64; w++) {
      total += atomic_load_explicit(i == 0 ? &popped[w] : &empties[w], memory_order_relaxed);
    }
    return total;
  }
  if (i == 1) {
    int count = 0, n = atomic_load_explicit(&head, memory_order_relaxed);
    while (n != 0 && count < NODES) {
      count++;
      n = atomic_load_explicit(&nodes[n].next, memory_order_relaxed);
    }
    return count;
  }
  if (i == 2 || i == 3) {
    int twice = 0, once = 0;
    for (int n = 1; n < NODES; n++) {
      int p = atomic_load_explicit(&nodes[n].pops, memory_order_relaxed);
      if (p > 1) twice++;
      if (p == 1) once++;
    }
    return i == 2 ? twice : once;
  }
  return -1;
}
