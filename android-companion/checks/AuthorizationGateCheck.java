package cn.xingyeji.companion;

public final class AuthorizationGateCheck {
    private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
    public static void main(String[] args) {
        AuthorizationGate gate = new AuthorizationGate();
        gate.resume();
        gate.focus(true);
        check(gate.begin("first"), "start authentication");
        check(!gate.begin("duplicate"), "reject overlapping prompts");
        gate.pause();
        gate.complete("first", true);
        check(gate.take() == null, "success must wait for activity resume");
        gate.resume();
        AuthorizationGate.Result success = gate.take();
        check(success != null && success.success && success.requestId.equals("first"), "deliver success on resume");
        check(gate.take() == null, "result delivered only once");
        gate.begin("overlay"); gate.focus(false); gate.complete("overlay", true);
        check(gate.take() == null, "wait until the biometric overlay releases window focus");
        gate.focus(true); check(gate.take().success, "deliver after overlay dismissal");
        gate.begin("cancelled"); gate.complete("cancelled", false);
        check(!gate.take().success, "cancellation never grants authorization");
        gate.begin("old-page"); gate.cancel(); gate.begin("new-page");
        gate.complete("old-page", true);
        check(gate.take() == null, "ignore stale callback after page replacement");
        gate.complete("new-page", false); gate.complete("new-page", true);
        check(!gate.take().success, "late duplicate callback cannot replace cancellation");
        gate.begin("destroyed"); gate.pause(); gate.complete("destroyed", true); gate.cancel(); gate.resume();
        check(gate.take() == null && !gate.pending(), "destroyed activity cannot unlock");
        System.out.println("Authorization handoff: pause/resume, cancellation, duplicate, stale and destroyed callbacks passed");
    }
}
