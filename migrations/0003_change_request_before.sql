-- 申請時点の値を残し、承認後も変更前と変更後を比べられるようにする
ALTER TABLE change_requests ADD COLUMN before_data TEXT;
