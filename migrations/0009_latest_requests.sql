-- Track latest phone number lookups per day for the "Latest Requests" dashboard widget.
CREATE TABLE IF NOT EXISTS latest_requests (
    date    TEXT NOT NULL,
    type    TEXT NOT NULL,
    service TEXT NOT NULL,
    code    TEXT NOT NULL,
    count   INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (date, type, service, code)
);
