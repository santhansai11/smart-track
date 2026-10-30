-- These migrations target Supabase (auth schema and roles must exist).
ALTER TABLE public.profiles ADD CONSTRAINT profile_auth_user FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE RESTRICT;

CREATE FUNCTION public.new_student_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.profiles(id,full_name,role,active,created_at)
  VALUES(NEW.id,left(coalesce(nullif(NEW.raw_user_meta_data->>'full_name',''),'Runner'),120),'STUDENT',true,now());
  RETURN NEW;
END $$;
CREATE TRIGGER create_student_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.new_student_profile();
INSERT INTO public.profiles(id,full_name,role,active,created_at)
SELECT id,left(coalesce(nullif(raw_user_meta_data->>'full_name',''),'Runner'),120),'STUDENT',true,now() FROM auth.users ON CONFLICT DO NOTHING;

CREATE FUNCTION public.is_root() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='ROOT' AND active)
$$;
CREATE FUNCTION public.is_member(room uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.room_members m JOIN public.profiles p ON p.id=m.user_id WHERE m.room_id=room AND m.user_id=auth.uid() AND p.active)
$$;
REVOKE ALL ON FUNCTION public.new_student_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_root() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_root(), public.is_member(uuid) TO authenticated;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['profiles','routes','route_versions','rooms','room_members','competitions','competition_participants','running_sessions','session_segments','gps_track_points','lap_records','recovery_requests','participant_status_history','competition_results','audit_logs'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
 END LOOP;
END $$;
-- Browsers only read narrow realtime state. Writes always pass backend validation.
GRANT SELECT ON public.profiles,public.rooms,public.room_members,public.competitions,public.competition_participants TO authenticated;
CREATE POLICY profile_self ON public.profiles FOR SELECT TO authenticated USING (id=auth.uid() OR public.is_root());
CREATE POLICY visible_rooms ON public.rooms FOR SELECT TO authenticated USING (public.is_member(id) OR public.is_root());
CREATE POLICY own_membership ON public.room_members FOR SELECT TO authenticated USING (user_id=auth.uid() OR public.is_root());
CREATE POLICY room_competitions ON public.competitions FOR SELECT TO authenticated USING (public.is_member(room_id) OR public.is_root());
CREATE POLICY participant_summary ON public.competition_participants FOR SELECT TO authenticated USING (public.is_root() OR EXISTS(SELECT 1 FROM public.competitions c WHERE c.id=competition_id AND public.is_member(c.room_id)));

CREATE FUNCTION public.guard_role() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.role<>'STUDENT') OR (TG_OP='UPDATE' AND NEW.role<>OLD.role) THEN
  IF coalesce(current_setting('smarttrack.bootstrap',true),'') <> 'enabled' THEN
   RAISE EXCEPTION 'Role changes require protected root provisioning';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_profile_role BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_role();

CREATE FUNCTION public.no_history_delete() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Historical records cannot be deleted by ordinary operations'; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['profiles','routes','route_versions','rooms','room_members','competitions','competition_participants','running_sessions','session_segments','lap_records','recovery_requests','participant_status_history','competition_results','audit_logs'] LOOP
  EXECUTE format('CREATE TRIGGER protect_history BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.no_history_delete()',t);
 END LOOP;
END $$;

CREATE FUNCTION public.immutable_record() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'This record is immutable'; END $$;
CREATE TRIGGER immutable_route_version BEFORE UPDATE ON public.route_versions FOR EACH ROW EXECUTE FUNCTION public.immutable_record();
CREATE TRIGGER immutable_lap BEFORE UPDATE ON public.lap_records FOR EACH ROW EXECUTE FUNCTION public.immutable_record();
CREATE TRIGGER immutable_audit BEFORE UPDATE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.immutable_record();
CREATE TRIGGER immutable_status_history BEFORE UPDATE ON public.participant_status_history FOR EACH ROW EXECUTE FUNCTION public.immutable_record();
CREATE TRIGGER immutable_result BEFORE UPDATE ON public.competition_results FOR EACH ROW EXECUTE FUNCTION public.immutable_record();
CREATE TRIGGER immutable_gps BEFORE UPDATE ON public.gps_track_points FOR EACH ROW EXECUTE FUNCTION public.immutable_record();

CREATE FUNCTION public.guard_gps_delete() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF coalesce(current_setting('smarttrack.retention',true),'') <> 'enabled' OR EXISTS(
   SELECT 1 FROM public.lap_records l WHERE l.session_id=OLD.session_id AND OLD.seq BETWEEN l.from_seq AND l.to_seq
 ) THEN RAISE EXCEPTION 'GPS evidence is protected'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER protect_gps_evidence BEFORE DELETE ON public.gps_track_points FOR EACH ROW EXECUTE FUNCTION public.guard_gps_delete();

CREATE FUNCTION public.guard_completed() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE cid uuid; BEGIN
 IF TG_TABLE_NAME='competitions' THEN
  IF OLD.status='COMPLETED' THEN RAISE EXCEPTION 'Published competitions are immutable'; END IF;
  IF NEW.route_version_id<>OLD.route_version_id OR NEW.room_id<>OLD.room_id THEN RAISE EXCEPTION 'Competition snapshot is immutable'; END IF;
  RETURN NEW;
 ELSIF TG_TABLE_NAME='competition_participants' THEN
  cid=OLD.competition_id;
  IF NEW.competition_id<>OLD.competition_id OR NEW.user_id<>OLD.user_id THEN RAISE EXCEPTION 'Participant snapshot is immutable'; END IF;
 ELSE
  SELECT p.competition_id INTO cid FROM public.competition_participants p WHERE p.id=OLD.participant_id;
 END IF;
 IF EXISTS(SELECT 1 FROM public.competitions WHERE id=cid AND status='COMPLETED') THEN RAISE EXCEPTION 'Published records are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER freeze_published BEFORE UPDATE ON public.competitions FOR EACH ROW EXECUTE FUNCTION public.guard_completed();
CREATE TRIGGER freeze_published BEFORE UPDATE ON public.competition_participants FOR EACH ROW EXECUTE FUNCTION public.guard_completed();
CREATE TRIGGER freeze_published BEFORE UPDATE ON public.running_sessions FOR EACH ROW EXECUTE FUNCTION public.guard_completed();

-- Explicit allowlist: never add gps_track_points to the realtime publication.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.competitions,public.competition_participants;
 END IF;
END $$;
