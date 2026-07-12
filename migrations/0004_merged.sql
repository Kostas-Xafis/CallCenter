-- Add merged flag column
ALTER TABLE phone_records ADD COLUMN merged INTEGER NOT NULL DEFAULT 0;

-- Insert one consolidated record per code that has 5+ services,
-- storing the individual service names as a JSON array.
INSERT INTO phone_records (type, service, code, merged)
SELECT
    MIN(type),
    json_group_array(service),
    code,
    1
FROM phone_records
GROUP BY code
HAVING COUNT(*) >= 5;

-- Remove the original individual rows for those codes
DELETE FROM phone_records
WHERE merged = 0
AND code IN (
    SELECT code FROM phone_records WHERE merged = 1
);
