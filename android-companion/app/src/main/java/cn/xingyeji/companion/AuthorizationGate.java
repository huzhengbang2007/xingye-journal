package cn.xingyeji.companion;

/** Main-thread authorization handoff; never deliver a result while the activity is paused. */
final class AuthorizationGate {
    private String request;
    private Boolean result;
    private boolean resumed;
    private boolean focused;

    boolean begin(String id) {
        if (request != null) return false;
        request = id; result = null;
        return true;
    }
    boolean pending() { return request != null; }
    boolean matches(String id) { return request != null && request.equals(id); }
    void complete(String id, boolean success) { if (matches(id) && result == null) result = success; }
    void resume() { resumed = true; }
    void pause() { resumed = false; }
    void focus(boolean value) { focused = value; }
    Result take() {
        if (!resumed || !focused || request == null || result == null) return null;
        Result next = new Result(request, result);
        cancel();
        return next;
    }
    void cancel() { request = null; result = null; }
    static final class Result {
        final String requestId;
        final boolean success;
        Result(String requestId, boolean success) { this.requestId = requestId; this.success = success; }
    }
}
