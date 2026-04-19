import { union, Trait, type Variant } from "../union.ts";

// ---------------------------------------------------------------------------
// Fault<E> — flat error union for async reactive pipelines
// ---------------------------------------------------------------------------
//
// Three variants cover every failure mode in AsyncDerived and watchEffect:
//
//   Fail<E>      — expected domain error; user threw Fault.Fail(myError)
//   Defect       — unexpected runtime panic; any unrecognised throw
//   Interrupted  — AbortSignal fired before the thunk completed
//
// Detection order in catch blocks:
//   1. instanceOf(Fault.Fail, e)  → Fail<E>
//   2. signal.aborted             → Interrupted(signal.reason)
//   3. otherwise                  → Defect(e)

abstract class FaultBase extends Trait {}

export type Fail<E>      = Variant<"Fail",        { error: E },           FaultBase>;
export type Defect       = Variant<"Defect",       { thrown: unknown },    FaultBase>;
export type Interrupted  = Variant<"Interrupted",  { reason?: unknown },   FaultBase>;

export type Fault<E> = Fail<E> | Defect | Interrupted;

export const Fault = union([FaultBase]).typed({
    Fail:        <E>(error: E)          => ({ error })   as Fail<E>,
    Defect:      (thrown: unknown)      => ({ thrown })  as Defect,
    Interrupted: (reason?: unknown)     => ({ reason })  as Interrupted,
});
