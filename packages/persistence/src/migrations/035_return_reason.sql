-- Optional customer-return reason; earlier records remain reason-less.
ALTER TABLE returns_return ADD COLUMN reason TEXT
  CHECK (reason IS NULL OR char_length(reason) <= 500);
