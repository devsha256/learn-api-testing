set JAVA_TOOL_OPTIONS=-javaagent:"C:/tools/byteman-download-4.0.20/lib/byteman.jar"=script:"C:/path/to/munit-leak-detector.btm" -Dcom.ning.http.client.AsyncHttpClientConfig.useProxyProperties=true

mvn clean test com.mulesoft.munit.tools:munit-maven-plugin:coverage-report "-Denv=dev"
