export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          created_at: string
          employee_id: string
          event: string
          id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          event: string
          id?: string
          task_id: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          event?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          id: number
          name: string
          protected: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          name: string
          protected?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          name?: string
          protected?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      permissions: {
        Row: {
          id: number
          key: string
        }
        Insert: {
          id?: number
          key: string
        }
        Update: {
          id?: number
          key?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          accepted_at: string | null
          created_at: string
          deleted_at: string | null
          department_id: number
          full_name: string
          id: string
          role_id: number
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          deleted_at?: string | null
          department_id: number
          full_name: string
          id: string
          role_id: number
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          deleted_at?: string | null
          department_id?: number
          full_name?: string
          id?: string
          role_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      ratings: {
        Row: {
          ai_suggested_score: number | null
          ai_summary: string | null
          comment: string | null
          created_at: string
          employee_id: string
          id: string
          period: string
          rated_by: string
          score: number
        }
        Insert: {
          ai_suggested_score?: number | null
          ai_summary?: string | null
          comment?: string | null
          created_at?: string
          employee_id: string
          id?: string
          period: string
          rated_by: string
          score: number
        }
        Update: {
          ai_suggested_score?: number | null
          ai_summary?: string | null
          comment?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          period?: string
          rated_by?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "ratings_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_rated_by_fkey"
            columns: ["rated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission_id: number
          role_id: number
        }
        Insert: {
          permission_id: number
          role_id: number
        }
        Update: {
          permission_id?: number
          role_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          assignable_work: boolean
          hr_grantable: boolean
          id: number
          name: string
          protected: boolean
        }
        Insert: {
          assignable_work?: boolean
          hr_grantable?: boolean
          id?: number
          name: string
          protected?: boolean
        }
        Update: {
          assignable_work?: boolean
          hr_grantable?: boolean
          id?: number
          name?: string
          protected?: boolean
        }
        Relationships: []
      }
      submissions: {
        Row: {
          employee_id: string
          file_path: string | null
          file_url: string | null
          hr_feedback: string | null
          id: string
          note: string
          reviewed_at: string | null
          submitted_at: string
          task_id: string
        }
        Insert: {
          employee_id: string
          file_path?: string | null
          file_url?: string | null
          hr_feedback?: string | null
          id?: string
          note: string
          reviewed_at?: string | null
          submitted_at?: string
          task_id: string
        }
        Update: {
          employee_id?: string
          file_path?: string | null
          file_url?: string | null
          hr_feedback?: string | null
          id?: string
          note?: string
          reviewed_at?: string | null
          submitted_at?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submissions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignment_history: {
        Row: {
          changed_by: string | null
          created_at: string
          from_user_id: string | null
          id: string
          reason: string | null
          request_id: string | null
          task_id: string
          to_user_id: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          from_user_id?: string | null
          id?: string
          reason?: string | null
          request_id?: string | null
          task_id: string
          to_user_id: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          from_user_id?: string | null
          id?: string
          reason?: string | null
          request_id?: string | null
          task_id?: string
          to_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignment_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignment_history_from_user_id_fkey"
            columns: ["from_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignment_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignment_history_to_user_id_fkey"
            columns: ["to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          ai_generated: boolean
          author_id: string
          body: string
          created_at: string
          id: string
          task_id: string
        }
        Insert: {
          ai_generated?: boolean
          author_id: string
          body: string
          created_at?: string
          id?: string
          task_id: string
        }
        Update: {
          ai_generated?: boolean
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_by: string
          assigned_to: string
          attachment_name: string | null
          attachment_path: string | null
          attachment_url: string | null
          created_at: string
          deadline: string
          deleted_at: string | null
          description: string | null
          id: string
          priority: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_by: string
          assigned_to: string
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_url?: string | null
          created_at?: string
          deadline: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          priority?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_by?: string
          assigned_to?: string
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_url?: string | null
          created_at?: string
          deadline?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          priority?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_department_history: {
        Row: {
          actor_id: string | null
          created_at: string
          from_department_id: number
          id: string
          reason: string
          request_id: string
          target_user_id: string
          to_department_id: number
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          from_department_id: number
          id?: string
          reason: string
          request_id: string
          target_user_id: string
          to_department_id: number
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          from_department_id?: number
          id?: string
          reason?: string
          request_id?: string
          target_user_id?: string
          to_department_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_department_history_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_department_history_from_department_id_fkey"
            columns: ["from_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_department_history_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_department_history_to_department_id_fkey"
            columns: ["to_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      user_lifecycle_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_kind: string
          created_at: string
          id: string
          new_role_id: number | null
          previous_role_id: number | null
          queued_task_count: number
          reason: string
          reassigned_task_count: number
          replacement_user_id: string | null
          request_id: string
          submitted_task_count: number
          target_user_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_kind: string
          created_at?: string
          id?: string
          new_role_id?: number | null
          previous_role_id?: number | null
          queued_task_count?: number
          reason: string
          reassigned_task_count?: number
          replacement_user_id?: string | null
          request_id: string
          submitted_task_count?: number
          target_user_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_kind?: string
          created_at?: string
          id?: string
          new_role_id?: number | null
          previous_role_id?: number | null
          queued_task_count?: number
          reason?: string
          reassigned_task_count?: number
          replacement_user_id?: string | null
          request_id?: string
          submitted_task_count?: number
          target_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_lifecycle_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_lifecycle_events_new_role_id_fkey"
            columns: ["new_role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_lifecycle_events_previous_role_id_fkey"
            columns: ["previous_role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_lifecycle_events_replacement_user_id_fkey"
            columns: ["replacement_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_lifecycle_events_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_list_users: {
        Args: never
        Returns: {
          accepted: boolean
          deleted_at: string
          department_id: number
          department_name: string
          email: string
          full_name: string
          id: string
          role: string
        }[]
      }
      archive_task_transaction: {
        Args: {
          p_approval_token?: string
          p_connection_hash?: string
          p_payload: Json
          p_request_id: string
        }
        Returns: Json
      }
      assignable_employees: {
        Args: never
        Returns: {
          full_name: string
          id: string
        }[]
      }
      can_view_performance_subject: {
        Args: { target: string }
        Returns: boolean
      }
      cancel_user_invite_provisioning: {
        Args: { p_token: string }
        Returns: undefined
      }
      create_task_transaction: {
        Args: {
          p_approval_token?: string
          p_connection_hash?: string
          p_payload: Json
          p_request_id: string
        }
        Returns: Json
      }
      decide_mcp_approval: {
        Args: { p_approval_token: string; p_decision: string }
        Returns: boolean
      }
      flag_overdue_tasks: { Args: never; Returns: undefined }
      get_mcp_approval: {
        Args: { p_approval_token: string }
        Returns: {
          client_name: string
          expires_at: string
          payload: Json
          request_id: string
          state: string
          target_id: string
          tool_name: string
        }[]
      }
      get_mcp_upload: {
        Args: { p_upload_token: string }
        Returns: {
          byte_size: number
          client_name: string
          content_type: string
          expires_at: string
          original_filename: string
          purpose: string
          state: string
          target_task_id: string
        }[]
      }
      has_permission: { Args: { perm: string }; Returns: boolean }
      historical_employees: {
        Args: never
        Returns: {
          accepted: boolean
          current_assignable: boolean
          deleted_at: string
          department_id: number
          department_name: string
          email: string
          full_name: string
          has_history: boolean
          id: string
          role: string
        }[]
      }
      is_active: { Args: never; Returns: boolean }
      is_assignable_employee: { Args: { target: string }; Returns: boolean }
      list_mcp_connections: {
        Args: never
        Returns: {
          client_name: string
          client_uri: string
          created_at: string
          id: string
          last_seen_at: string
          revoked_at: string
        }[]
      }
      mcp_approve_write: {
        Args: { p_approval_token: string; p_connection_hash: string }
        Returns: boolean
      }
      mcp_complete_upload: {
        Args: {
          p_byte_size: number
          p_content_type: string
          p_object_path: string
          p_original_filename: string
          p_upload_token: string
        }
        Returns: boolean
      }
      mcp_prepare_upload: {
        Args: {
          p_client_name: string
          p_client_uri: string
          p_connection_hash: string
          p_purpose: string
          p_target_task_id?: string
        }
        Returns: {
          expires_at: string
          state: string
          upload_token: string
        }[]
      }
      mcp_prepare_write: {
        Args: {
          p_client_name: string
          p_client_uri: string
          p_connection_hash: string
          p_payload: Json
          p_request_id: string
          p_target_id: string
          p_tool_name: string
        }
        Returns: {
          approval_token: string
          completed_result: Json
          expires_at: string
          payload_hash: string
          state: string
        }[]
      }
      mcp_resolve_upload: {
        Args: {
          p_connection_hash: string
          p_purpose: string
          p_target_task_id?: string
          p_upload_token: string
        }
        Returns: {
          object_path: string
          original_filename: string
        }[]
      }
      mcp_touch_connection: {
        Args: {
          p_client_name: string
          p_client_uri?: string
          p_downstream_client_hash: string
        }
        Returns: string
      }
      move_user_department: {
        Args: {
          p_new_department_id: number
          p_reason: string
          p_request_id: string
          p_target_user_id: string
        }
        Returns: {
          duplicate_request: boolean
          from_department_id: number
          to_department_id: number
        }[]
      }
      my_role: { Args: never; Returns: string }
      offboard_user: {
        Args: {
          p_action: string
          p_reason?: string
          p_replacement_user_id?: string
          p_request_id: string
          p_target_role_id?: number
          p_target_user_id: string
        }
        Returns: {
          duplicate_request: boolean
          queued_task_count: number
          reassigned_task_count: number
          submitted_task_count: number
        }[]
      }
      offboarding_queue: {
        Args: never
        Returns: {
          assignee_state: string
          category: string
          task_id: string
        }[]
      }
      prepare_user_invite: {
        Args: {
          p_created_by: string
          p_department_id: number
          p_email: string
          p_full_name: string
        }
        Returns: string
      }
      review_submission_transaction: {
        Args: {
          p_approval_token?: string
          p_connection_hash?: string
          p_payload: Json
          p_request_id: string
        }
        Returns: Json
      }
      revoke_mcp_connection: {
        Args: { p_connection_id: string }
        Returns: boolean
      }
      start_task_transaction: {
        Args: {
          p_approval_token?: string
          p_connection_hash?: string
          p_payload: Json
          p_request_id: string
        }
        Returns: Json
      }
      submit_work_transaction: {
        Args: {
          p_approval_token?: string
          p_connection_hash?: string
          p_payload: Json
          p_request_id: string
        }
        Returns: Json
      }
      update_task_transaction: {
        Args: {
          p_approval_token?: string
          p_connection_hash?: string
          p_payload: Json
          p_request_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
