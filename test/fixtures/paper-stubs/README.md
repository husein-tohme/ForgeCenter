Minimal stand-ins for the parts of the Paper API that Plugin Forge's generated code uses,
with the same signatures as the real API. Tests compile generated plugins against these
with javac, since Paper's Maven repository may not be reachable where tests run.
