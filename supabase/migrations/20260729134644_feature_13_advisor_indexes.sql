-- Feature 13 advisor follow-up: cover every new foreign key.
create index pending_user_provisioning_department_idx
  on private.pending_user_provisioning (department_id);

create index pending_user_provisioning_created_by_idx
  on private.pending_user_provisioning (created_by);
