//! Own the Worker and its descendants without waiting in an OS termination path.

use std::io;
use std::ops::{Deref, DerefMut};
use std::process::{Child, Command};

pub(super) struct WorkerProcess {
    child: Child,
    #[cfg(windows)]
    job: Job,
}

impl WorkerProcess {
    pub(super) fn spawn(command: &mut Command) -> io::Result<Self> {
        #[cfg(windows)]
        let job = Job::new()?;
        let child = command.spawn()?;
        #[cfg(windows)]
        let mut child = child;
        #[cfg(windows)]
        if let Err(error) = job.assign(&child) {
            // Never hand an uncontained process to the Host. Termination is
            // asynchronous; waiting here can hang on a GPU driver teardown.
            let _ = child.kill();
            return Err(error);
        }
        Ok(Self {
            child,
            #[cfg(windows)]
            job,
        })
    }

    pub(super) fn terminate(&mut self) {
        #[cfg(windows)]
        self.job.terminate();
        let _ = self.child.kill();
        // Do not call Child::wait here. Windows may keep a terminating CUDA
        // process alive indefinitely even after TerminateProcess succeeds.
    }
}

impl Deref for WorkerProcess {
    type Target = Child;

    fn deref(&self) -> &Self::Target {
        &self.child
    }
}

impl DerefMut for WorkerProcess {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.child
    }
}

impl Drop for WorkerProcess {
    fn drop(&mut self) {
        // Closing the non-inheritable Job handle kills any remaining children,
        // including when the Host itself crashes. It does not join them.
        #[cfg(not(windows))]
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

#[cfg(windows)]
struct Job(std::os::windows::io::OwnedHandle);

#[cfg(windows)]
impl Job {
    fn new() -> io::Result<Self> {
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use windows_sys::Win32::System::JobObjects::{
            CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject,
        };

        // Null security attributes create a handle children cannot inherit.
        let raw = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if raw.is_null() {
            return Err(io::Error::last_os_error());
        }
        let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let success = unsafe {
            SetInformationJobObject(
                handle.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            )
        };
        if success == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(handle))
    }

    fn assign(&self, child: &Child) -> io::Result<()> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;

        if unsafe { AssignProcessToJobObject(self.0.as_raw_handle(), child.as_raw_handle()) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    fn terminate(&self) {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;

        unsafe { TerminateJobObject(self.0.as_raw_handle(), 1) };
    }
}

#[cfg(test)]
pub(super) mod tests {
    use std::process::{Command, Stdio};
    use std::time::Duration;

    use super::WorkerProcess;

    const FIXTURE_ROLE: &str = "WHISPER_SUBTITLE_PROCESS_TEST_ROLE";

    pub(in crate::worker_host) fn sleeper() -> WorkerProcess {
        let mut command = fixture_command("sleeper");
        WorkerProcess::spawn(&mut command).expect("spawn controlled fixture")
    }

    fn fixture_command(role: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().expect("test executable"));
        command
            .args([
                "--exact",
                "worker_host::process::tests::fixture_process",
                "--ignored",
                "--nocapture",
            ])
            .env(FIXTURE_ROLE, role)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        command
    }

    #[test]
    #[ignore = "subprocess fixture invoked only by process lifecycle tests"]
    fn fixture_process() {
        if std::env::var(FIXTURE_ROLE).as_deref() == Ok("parent") {
            use std::io::{Read, Write};
            // Wait until the test has assigned this process to its Job.
            std::io::stdin().read_exact(&mut [0]).expect("start signal");
            let mut child = fixture_command("sleeper").spawn().expect("descendant");
            println!("DESCENDANT_PID={}", child.id());
            std::io::stdout().flush().expect("flush descendant pid");
            child.wait().expect("descendant exit");
        }
        std::thread::sleep(Duration::from_secs(60));
    }

    #[cfg(windows)]
    #[test]
    fn dropping_worker_owner_terminates_its_descendants() {
        use std::io::{BufRead, BufReader, Write};
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use windows_sys::Win32::Foundation::WAIT_OBJECT_0;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject,
        };

        let mut worker = WorkerProcess::spawn(&mut fixture_command("parent")).unwrap();
        worker.stdin.as_mut().unwrap().write_all(b"s").unwrap();
        let descendant_pid = BufReader::new(worker.stdout.take().unwrap())
            .lines()
            .map(|line| line.unwrap())
            .find_map(|line| line.strip_prefix("DESCENDANT_PID=")?.parse::<u32>().ok())
            .expect("descendant pid");
        let process = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, descendant_pid) };
        assert!(!process.is_null(), "descendant must be running before drop");
        let process = unsafe { OwnedHandle::from_raw_handle(process) };
        drop(worker);
        assert_eq!(
            unsafe { WaitForSingleObject(process.as_raw_handle(), 5_000) },
            WAIT_OBJECT_0,
            "closing the Worker owner must also stop its descendant"
        );
    }
}
